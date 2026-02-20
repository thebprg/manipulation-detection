import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@deepgram/sdk';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || 'dummy_key_for_build';

export async function POST(request: NextRequest) {
  try {
    const { audioBase64 } = await request.json();

    if (!audioBase64) {
      return NextResponse.json(
        { error: 'No audio data provided' },
        { status: 400 }
      );
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    // Initialize Deepgram client
    const deepgram = createClient(DEEPGRAM_API_KEY);

    // Transcribe the audio
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: 'nova-2',
        language: 'en',
        smart_format: true,
        punctuate: true,
        diarize: false,
      }
    );

    if (error) {
      console.error('Deepgram error:', error);
      return NextResponse.json(
        { error: 'Transcription failed: ' + error.message },
        { status: 500 }
      );
    }

    // Extract transcription text
    const transcription = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    if (!transcription) {
      return NextResponse.json({
        transcription: '[No speech detected in audio]',
        words: 0,
      });
    }

    return NextResponse.json({
      transcription,
      words: transcription.split(' ').length,
    });

  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Transcription failed' },
      { status: 500 }
    );
  }
}
