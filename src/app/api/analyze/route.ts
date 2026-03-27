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
    throw error; // Throw instead of swallowing, to return a 500 HTTP error and stop parsing empty JSON
  }
}

export async function POST(request: NextRequest) {
  try {
    const { transcription, frames, reelDescription, url, duration, uploaderName, reelTitle, model, imageModel, mediaType, rowNumber } = await request.json();

    // Extract domain for V0 hints
    let domain = 'Unknown';
    try {
      if (url) {
        const parsedUrl = new URL(url);
        domain = parsedUrl.hostname.replace('www.', '');
      }
    } catch (e) {
      console.error('Failed to parse URL domain:', e);
    }

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

    // Prepare image parts from frames (use up to 15 frames for analysis)
    const framesToUse = frames.slice(0, 15);
    const selectedImageModel = imageModel || 'google/gemma-3-27b-it';
    const descriptionText = reelDescription || '[No description available]';

    let imageAnalysis = '';

    // Step 1: Image Analysis (Vision context)
    console.log(`Step 1: Analyzing visual content using ${selectedImageModel}...`);
    const imageAnalysisPrompt = `Analyze the visual content of these Instagram post/Reel frames objectively.

Focus on extracting factual visual details that align with social media manipulation constraints:

1. **Setting & Presentation**: 
   - Is the video/image shot in a candid, user-generated style (e.g., a bedroom, car, or home kitchen) to build trust, or is it a highly polished commercial studio?
   - Are there explicit disclosures of sponsorship (e.g., "#ad", "sponsored", "paid partnership") visible on screen?
2. **Emotional & Psychological Pressure**:
   - Are there text overlays mentioning urgency, sales, discounts, or deadlines (e.g., "Sale ends today", "Limited time", "Buy now")?
   - Does the host's facial expression convey intense emotion, anxiety, or manufactured excitement?
3. **Parasocial Interaction**:
   - Does the creator make direct, intimate eye contact with the viewer?
   - Do they use gestures (pointing at the camera, leaning in) to simulate a one-on-one conversation?
4. **Visual Deception & Claims**:
   - Are there side-by-side "Before & After" shots?
   - Is a product being physically demonstrated, and does the demonstration appear exaggerated or artificially enhanced (e.g., heavy beauty filters, altered lighting on a product)?

Provide a detailed paragraph synthesizing these specific visual aspects. Do not make assumptions about the creator's true intent—just stick to the visual facts.`;

    try {
      if (selectedImageModel === 'google/gemma-3-27b-it') {
        const gemmaModel = genAI.getGenerativeModel({ model: 'gemma-3-27b-it' });
        const imageParts = framesToUse.map((frame: string) => {
          const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');
          return {
            inlineData: {
              data: base64Data,
              mimeType: 'image/jpeg',
            },
          };
        });

        const imageAnalysisResult = await gemmaModel.generateContent([
          imageAnalysisPrompt,
          ...imageParts,
        ]);
        
        if (!imageAnalysisResult.response || !imageAnalysisResult.response.candidates || imageAnalysisResult.response.candidates.length === 0) {
          throw new Error("Response blocked or no candidates returned by Gemma.");
        }
        
        try {
          imageAnalysis = imageAnalysisResult.response.text();
        } catch (textError) {
          throw new Error("Response was blocked by safety filters (PROHIBITED_CONTENT / OTHER).");
        }
        
        if (!imageAnalysis) throw new Error("Empty text returned.");

      } else {
        // Use Nvidia NIM VLM using OpenAI client struct
        const contentArr: any[] = [{ type: 'text', text: imageAnalysisPrompt }];
        for (const frame of framesToUse) {
           contentArr.push({ type: 'image_url', image_url: { url: frame } });
        }
        
        const response = await nvidia.chat.completions.create({
          model: selectedImageModel,
          messages: [{ role: 'user', content: contentArr }],
          max_tokens: 1024,
          temperature: 0.5,
        });
        imageAnalysis = response.choices[0]?.message?.content || '';
        if (!imageAnalysis) throw new Error("Empty text returned by Nvidia VLM.");
      }
    } catch (visionError) {
      console.error(`Vision Analysis Error (${selectedImageModel}):`, visionError);
      imageAnalysis = '[Cannot describe the images due to safety filters or an API error with the selected VLM. Proceed with analysis using only the available text caption and audio transcription data.]';
    }

    console.log(`Step 2: Performing Codebook Analysis using ${selectedModel}...`);

    let formatHint = `- The video duration is calculated as: **${duration} seconds**. Use this to explicitly determine V2 (Post Media Format). Since this is a video reel, you MUST explicitly code V2 (Post Media Format) as 3.`;
    if (mediaType === 'image_single') {
      formatHint = `- The media was explicitly extracted as a single image post. You MUST explicitly code V2 (Post Media Format) as 1.`;
    } else if (mediaType === 'image_carousel') {
      formatHint = `- The media was explicitly extracted as an image carousel post (multiple swipeable images). You MUST explicitly code V2 (Post Media Format) as 2.`;
    }

    const CODEBOOK_PROMPT = `You are a strict, objective analyst applying a specific codebook to rate a social media post for manipulation.

CRITICAL INSTRUCTIONS:
- Not every social media content is advertising and not every Ad is manipulative. Evaluate fairly.
- Read the CODEBOOK below carefully.
- Evaluate the content using variables V0 through V14.
- Make sure to carefully follow the scoring instructions for V14 (MANIP_INT) by scoring V5 through V12 first, and then mapping the sum to the 4-point scale.
- For each coded variable, you MUST provide the assigned scale (numeric) and a 1-sentence reason referencing specific evidence from the transcript or visual descriptions.

ACCURACY HINTS FOR V1 & V2:
- The source URL domain is identified as: **${domain}**. Use this to explicitly determine V1 (Platform). For example, if it's instagram.com, V1 scale is 3. If tiktok.com, V1 scale is 2.
${formatHint}

EVALUATION HINTS FOR OTHER VARIABLES:
- **V6 (TRUST_BLUR)**: Cross-reference the "Setting & Presentation" and "Parasocial Interaction" from the Visual Analysis with the transcript tone. Candid visual settings paired with highly scripted commercial pitches are a key indicator of trust exploitation.
- **V5 (SCRIPT_STR)**: Look strictly for urgency ("now", "today only") and scarcity ("only 5 left", "limited edition") signals in both the transcript and visual descriptions.
- **V11 (PROD_CUE)**: Rely on the Visual Analysis for notes on heavy text overlays, jump cuts, "Before & After" layouts or exaggerated product demonstrations.

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
    "name": "TYPE — Post Content Type",
    "scale": 2,
    "reason": "The content promotes an external brand as indicated by the affiliate link in the description."
  },
  {
    "id": "V1",
    "name": "PLAT — Platform",
    "scale": 3,
    "reason": "The content is an Instagram reel as indicated by the context."
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

    // Ensure V0..V14 exist
    for (let i = 0; i <= 14; i++) {
      const vId = `V${i}`;
      if (varsMap[vId] === undefined) {
        varsMap[vId] = "N/A";
      }
    }

    // Structure logData for output
    const logData = {
      rowNumber: rowNumber || null,
      Account_ID: rowNumber ? undefined : (uploaderName || "Unknown"), // Don't overwrite if batch processing
      URL: rowNumber ? undefined : (url || "N/A"), // Don't overwrite if batch processing
      V0: varsMap["V0"],
      V1: varsMap["V1"],
      V2: varsMap["V2"],
      V3: varsMap["V3"],
      V4: varsMap["V4"],
      V5: varsMap["V5"],
      V6: varsMap["V6"],
      V7: varsMap["V7"],
      V8: varsMap["V8"],
      V9: varsMap["V9"],
      V10: varsMap["V10"],
      V11: varsMap["V11"],
      V12: varsMap["V12"],
      V13: varsMap["V13"],
      V14: varsMap["V14"],
      Justifications: codebookData.map((v: any) => `${v.id}: ${v.reason}`).join('\n')
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
