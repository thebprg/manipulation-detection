import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const GOOGLE_SHEET_SCRIPT_URL = process.env.GOOGLE_SHEET_SCRIPT_URL;

// Gemini for image analysis
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');

// Cerebras Client
const cerebras = new OpenAI({
  apiKey: CEREBRAS_API_KEY || 'dummy_key_for_build',
  baseURL: 'https://api.cerebras.ai/v1',
});

// Nvidia NIM Client
const nvidia = new OpenAI({
  apiKey: NVIDIA_API_KEY || 'dummy_key_for_build',
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

async function logToGoogleSheet(data: any) {
  if (!GOOGLE_SHEET_SCRIPT_URL) return;
  try {
    await fetch(GOOGLE_SHEET_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    console.log('Successfully logged to Google Sheet');
  } catch (error) {
    console.error('Failed to log to Google Sheet:', error);
  }
}

// Helper function to call LLM (Cerebras or Nvidia)
async function callLLM(prompt: string, model: string = 'cerebras-native'): Promise<string> {
  let client = nvidia;
  let modelName = model;

  // Use Cerebras native client for the specific model or if selected explicitly
  if (model === 'cerebras-native') {
    client = cerebras;
    modelName = 'gpt-oss-120b';
  }

  try {
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.7,
    });
    
    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error(`LLM API Error (${model}):`, error);
    return ''; 
  }
}

export async function POST(request: NextRequest) {
  try {
    const { transcription, frames, reelDescription, url, duration, uploaderName, reelTitle, model } = await request.json();

    // Default to cerebras-native if model is not provided
    const selectedModel = model || 'cerebras-native';

    if (!transcription && (!frames || frames.length === 0)) {
      return NextResponse.json(
        { error: 'No content provided for analysis' },
        { status: 400 }
      );
    }

    // Read the rules.json file
    const rulesPath = path.join(process.cwd(), 'rules.json');
    let rulesJsonStr = '';
    try {
      rulesJsonStr = fs.readFileSync(rulesPath, 'utf8');
    } catch (e) {
      console.error('Failed to read rules.json:', e);
      rulesJsonStr = '{"error": "Could not load rules.json server-side"}';
    }

    // Gemma 3 model for image analysis only
    const gemmaModel = genAI.getGenerativeModel({ model: 'gemma-3-27b-it' });

    // Prepare image parts from frames (use up to 15 frames for analysis)
    const framesToUse = frames.slice(0, 15);
    const imageParts = framesToUse.map((frame: string) => {
      const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');
      return {
        inlineData: {
          data: base64Data,
          mimeType: 'image/jpeg',
        },
      };
    });

    const descriptionText = reelDescription || '[No description available]';

    // Step 1: Image Analysis (Gemma 3 - for visual content context)
    console.log('Step 1: Analyzing visual content (Gemma 3 27B)...');
    const imageAnalysisPrompt = `Analyze the visual content of these Instagram Reel frames objectively.

First, determine: Is this commercial/promotional content or personal/entertainment content?

Describe:
1. **Scene & Setting**: What is visually happening? Home, studio, outdoor, product-focused?
2. **Visual Elements & OCR**: Any brand logos, products prominently displayed, text overlays with offers?
3. **Presentation Style**: Is it candid personal content or highly polished promotional content?
4. **Commercial Indicators**: Are products being demonstrated? Are there before/after shots, filters, or price/discount displays?

Be objective - describe what you SEE without assuming commercial intent.`;

    const imageAnalysisResult = await gemmaModel.generateContent([
      imageAnalysisPrompt,
      ...imageParts,
    ]);
    const imageAnalysis = imageAnalysisResult.response.text();

    console.log(`Step 2: Performing Codebook Analysis using ${selectedModel}...`);

    const CODEBOOK_PROMPT = `You are a strict, objective analyst applying a specific codebook to rate a social media post for manipulation.

CRITICAL INSTRUCTIONS:
- Not every social media content is advertising and not every Ad is manipulative. Evaluate fairly.
- Read the CODEBOOK below carefully.
- Evaluate the content using variables V0 through V12.
- DO NOT CODE V9 (Saturation). Leave it completely out of your output.
- For each coded variable, provide the assigned scale (numeric) and a 1-sentence reason referencing specific evidence from the transcript or visual descriptions.

CODEBOOK RULES:
${rulesJsonStr}

---
CONTEXT TO ANALYZE:

REEL DESCRIPTION/CAPTION:
${descriptionText}

AUDIO TRANSCRIPTION:
${transcription || '[No audio transcription available]'}

IMAGE CONTEXT (Visual Analysis):
${imageAnalysis}
---

OUTPUT FORMAT REQUIRED:
Return ONLY a valid JSON array of objects. Do not include markdown codeblocks (\`\`\`json), explanations, or any other text outside the JSON array.
Example Format:
[
  {
    "id": "V0",
    "name": "PLAT — Platform",
    "scale": 3,
    "reason": "The content is an Instagram reel as indicated by the context."
  },
  {
    "id": "V1",
    "name": "FORMAT — Content Type",
    "scale": 3,
    "reason": "It is a short video reel with multiple frames analyzed."
  }
]
`;

    const codebookResponseText = await callLLM(CODEBOOK_PROMPT, selectedModel);

    // Parse the JSON array
    let codebookData = [];
    try {
      const jsonMatch = codebookResponseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        codebookData = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: try parsing the whole thing if no brackets were used but it is valid JSON
        codebookData = JSON.parse(codebookResponseText);
      }
    } catch (parseError) {
      console.error('Failed to parse Codebook JSON:', parseError);
      console.error('Raw LLM Response:', codebookResponseText);
      codebookData = [
        {
          id: "Error",
          name: "Parsing Failed",
          scale: 0,
          reason: "The LLM failed to return a valid JSON array."
        }
      ];
    }

    // Map extracted variables to the fixed Google Sheets schema
    const varsMap: Record<string, string | number> = {};
    codebookData.forEach((v: any) => {
      if (v.id) {
        varsMap[v.id.toUpperCase()] = v.scale !== undefined ? v.scale : "N/A";
      }
    });

    // Ensure V0..V12 exist
    for (let i = 0; i <= 12; i++) {
      if (i === 9) continue;
      const vId = `V${i}`;
      if (varsMap[vId] === undefined) {
        varsMap[vId] = "N/A";
      }
    }

    // Structure logData for output
    const logData = {
      Account_ID: uploaderName || "Unknown",
      URL: url || "N/A",
      V0: varsMap["V0"],
      V1: varsMap["V1"],
      V2: varsMap["V2"],
      V3: varsMap["V3"],
      V4: varsMap["V4"],
      V5: varsMap["V5"],
      V6: varsMap["V6"],
      V7: varsMap["V7"],
      V8: varsMap["V8"],
      V10: varsMap["V10"],
      V11: varsMap["V11"],
      V12: varsMap["V12"]
    };

    if (GOOGLE_SHEET_SCRIPT_URL) {
      logToGoogleSheet(logData).catch(e => console.error("Logging failed:", e));
    } else {
      console.warn("GOOGLE_SHEET_SCRIPT_URL not set, skipping logging.");
    }

    return NextResponse.json({
      imageAnalysis, // Pass image analysis to frontend for context display
      codebook: codebookData
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
