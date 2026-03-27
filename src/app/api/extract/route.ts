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
      
      const outputPathPattern = path.join(tempDir, 'media_%(autonumber)s.%(ext)s');
      // Added --ignore-no-formats-error so yt-dlp doesn't throw if it only finds images,
      // though for IG it still often fails. 
      const ytDlpCmd = `yt-dlp ${cookiesArg} --ignore-no-formats-error --write-info-json -o "${outputPathPattern}" "${url}"`;
      console.log(`Executing yt-dlp command...`);
      
      try {
        await execAsync(ytDlpCmd, { timeout: 90000 });
      } catch (ytErr) {
        console.warn(`yt-dlp encountered an error (likely no video formats). Proceeding to check for partial downloads...`);
      }

      // Check downloaded files recursively
      let allFiles = fs.readdirSync(tempDir, { recursive: true }) as string[];
      
      // Determine if it's a video or image post
      let videoFiles = allFiles.filter(f => f.endsWith('.mp4') || f.endsWith('.webm'));
      let imageFiles = allFiles.filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp') || f.endsWith('.png'));

      // FALLBACK: If yt-dlp failed completely for images, use gallery-dl
      if (videoFiles.length === 0 && imageFiles.length === 0) {
        console.log(`yt-dlp failed to extract media. Falling back to gallery-dl for images...`);
        try {
          // Self-healing command: checks if gallery-dl exists, installs if not, then runs it.
          const checkInstallCmd = `python3 -c "import gallery_dl" 2>/dev/null || python3 -m pip install gallery-dl --user`;
          await execAsync(checkInstallCmd, { timeout: 60000 });
          
          const galleryDlCmd = `python3 -m gallery_dl ${cookiesArg} -d "${tempDir}" "${url}"`;
          await execAsync(galleryDlCmd, { timeout: 90000 });
          
          // Refresh file lists
          allFiles = fs.readdirSync(tempDir, { recursive: true }) as string[];
          videoFiles = allFiles.filter(f => f.endsWith('.mp4') || f.endsWith('.webm'));
          imageFiles = allFiles.filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp') || f.endsWith('.png'));
        } catch (gdlErr) {
          console.error("gallery-dl fallback also failed:", gdlErr);
        }
      }
      
      let isVideo = videoFiles.length > 0;
      let finalVideoPath = isVideo ? path.join(tempDir, videoFiles[0]) : '';
      let mediaType = isVideo ? 'video' : (imageFiles.length > 1 ? 'image_carousel' : 'image_single');

      if (!isVideo && imageFiles.length === 0) {
        throw new Error('Failed to download any video or image media with both yt-dlp and gallery-dl.');
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

      // If it's a video, extract audio, duration, and frames using ffmpeg
      let duration = 0;
      let audioBase64 = '';
      const frames: string[] = [];
      let videoBase64Final = '';

      if (isVideo) {
        console.log('Extracting audio from video...');
        try {
          await execAsync(
            `ffmpeg -i "${finalVideoPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}" -y`,
            { timeout: 30000 }
          );
        } catch (audioExtErr) {
          console.warn('Audio extraction failed or no audio stream found.');
        }

        // Get video duration
        const { stdout: durationOutput } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalVideoPath}"`
        );
        duration = parseFloat(durationOutput.trim()) || 10;

        // Extract 30 frames evenly spaced across the video
        const totalFrames = 30;
        const interval = duration / totalFrames;
        console.log(`Extracting ${totalFrames} frames evenly spaced across ${duration.toFixed(1)}s video (interval: ${interval.toFixed(2)}s)...`);
        
        await execAsync(
          `ffmpeg -i "${finalVideoPath}" -vf "select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${interval})'" -vsync 0 -q:v 2 "${framesDir}/frame_%03d.jpg" -y`,
          { timeout: 60000 }
        );

        // Read frames and convert to base64
        const frameFiles = fs.readdirSync(framesDir)
          .filter(f => f.endsWith('.jpg'))
          .sort();

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
        if (!skipVideo) {
          try {
            const videoData = fs.readFileSync(finalVideoPath);
            const videoBase64 = videoData.toString('base64');
            videoBase64Final = `data:video/mp4;base64,${videoBase64}`;
          } catch (e) {
            console.error("Failed to read video for base64: ", e);
          }
        }
      } else {
        // Handle images/carousels natively
        console.log(`Media is images. Total images: ${imageFiles.length}`);
        duration = 0; // Special flag for image posts
        
        // Convert all images to base64
        const sortedImages = imageFiles.sort();
        // Limit to 15 frames max for carousels to save API token costs
        const maxImageFrames = 15;
        for (const imgName of sortedImages.slice(0, maxImageFrames)) {
          const imgPath = path.join(tempDir, imgName);
          try {
             const imgData = fs.readFileSync(imgPath);
             // Guess MIME type
             let mime = 'image/jpeg';
             if (imgName.endsWith('.webp')) mime = 'image/webp';
             if (imgName.endsWith('.png')) mime = 'image/png';
             const base64 = imgData.toString('base64');
             frames.push(`data:${mime};base64,${base64}`);
          } catch(e) {
             console.error(`Failed to read image ${imgName}:`, e);
          }
        }
      }

      // Cleanup temp directory
      await fs.promises.rm(tempDir, { recursive: true, force: true });

      return NextResponse.json({
        videoPath: 'extracted',
        videoBase64: videoBase64Final, // Empty string for image posts
        audioPath: audioBase64,
        frames,
        duration,
        mediaType, // Pass back explicitly to frontend / analyze route
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
