import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const { url, skipVideo } = await request.json();

    if (!url || !url.includes('instagram.com')) {
      return NextResponse.json(
        { error: 'Invalid Instagram URL' },
        { status: 400 }
      );
    }

    // Create temporary directory for this extraction
    const tempDir = path.join(os.tmpdir(), `insta_${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    const videoPath = path.join(tempDir, 'video.mp4');
    const audioPath = path.join(tempDir, 'audio.mp3');
    const framesDir = path.join(tempDir, 'frames');
    const infoPath = path.join(tempDir, 'info.json');
    await fs.promises.mkdir(framesDir, { recursive: true });

    try {
      // Download video and extract metadata using yt-dlp
      console.log('Downloading video with yt-dlp and extracting metadata...');
      
      // Check for cookies.txt to bypass Instagram login walls / rate limits
      const cookiesPath = path.join(process.cwd(), 'cookies.txt');
      const cookiesArg = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
      
      const ytDlpCmd = `yt-dlp -f "best[ext=mp4]" --no-playlist --write-info-json ${cookiesArg} -o "${videoPath}" "${url}"`;
      console.log(`Executing yt-dlp command...`);
      
      await execAsync(
        ytDlpCmd,
        { timeout: 90000 }
      );

      // Check if video was downloaded
      if (!fs.existsSync(videoPath)) {
        throw new Error('Failed to download video');
      }

      // Read video metadata (description, title, uploader, etc.)
      let reelDescription = '';
      let reelTitle = '';
      let uploaderName = '';
      let videoUrl = url;
      
      // Find the info.json file (yt-dlp names it based on the output file)
      const infoFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.info.json'));
      if (infoFiles.length > 0) {
        const infoFilePath = path.join(tempDir, infoFiles[0]);
        try {
          const infoContent = fs.readFileSync(infoFilePath, 'utf-8');
          const info = JSON.parse(infoContent);
          reelDescription = info.description || info.title || '';
          reelTitle = info.title || info.fulltitle || '';
          uploaderName = info.uploader || info.channel || info.uploader_id || '';
          videoUrl = info.webpage_url || url;
        } catch (parseError) {
          console.log('Could not parse info.json:', parseError);
        }
      }

      // Extract audio using ffmpeg
      console.log('Extracting audio...');
      let audioBase64 = '';
      try {
        await execAsync(
          `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}" -y`,
          { timeout: 30000 }
        );
      } catch (audioExtErr) {
        console.warn('Audio extraction failed or no audio stream found.');
      }

      // Get video duration
      const { stdout: durationOutput } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
      );
      const duration = parseFloat(durationOutput.trim()) || 10;

      // Extract 30 frames evenly spaced across the video
      const totalFrames = 30;
      const interval = duration / totalFrames;
      console.log(`Extracting ${totalFrames} frames evenly spaced across ${duration.toFixed(1)}s video (interval: ${interval.toFixed(2)}s)...`);
      
      // Use ffmpeg select filter to extract frames at specific intervals
      await execAsync(
        `ffmpeg -i "${videoPath}" -vf "select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${interval})'" -vsync 0 -q:v 2 "${framesDir}/frame_%03d.jpg" -y`,
        { timeout: 60000 }
      );

      // Read frames and convert to base64
      const frameFiles = fs.readdirSync(framesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();

      const frames: string[] = [];
      for (const frameFile of frameFiles.slice(0, totalFrames)) {
        const framePath = path.join(framesDir, frameFile);
        const frameData = fs.readFileSync(framePath);
        const base64 = frameData.toString('base64');
        frames.push(`data:image/jpeg;base64,${base64}`);
      }

      // Read audio and convert to base64 if it exists
      if (fs.existsSync(audioPath)) {
        const audioData = fs.readFileSync(audioPath);
        audioBase64 = audioData.toString('base64');
      }

      // Read video and convert to base64 for playback, UNLESS skipVideo is true
      let videoBase64Final = '';
      if (!skipVideo) {
        try {
          const videoData = fs.readFileSync(videoPath);
          const videoBase64 = videoData.toString('base64');
          videoBase64Final = `data:video/mp4;base64,${videoBase64}`;
        } catch (e) {
          console.error("Failed to read video for base64: ", e);
        }
      }

      // Cleanup temp directory
      await fs.promises.rm(tempDir, { recursive: true, force: true });

      return NextResponse.json({
        videoPath: 'extracted',
        videoBase64: videoBase64Final,
        audioPath: audioBase64,
        frames,
        duration,
        reelDescription,
        reelTitle,
        uploaderName,
        originalUrl: videoUrl,
      });

    } catch (extractError) {
      // Cleanup on error
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw extractError;
    }

  } catch (error) {
    console.error('Extraction error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Extraction failed' },
      { status: 500 }
    );
  }
}
