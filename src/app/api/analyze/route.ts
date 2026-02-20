import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const GOOGLE_SHEET_SCRIPT_URL = process.env.GOOGLE_SHEET_SCRIPT_URL;

// Gemini for image analysis
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');

// Cerebras Client
const cerebras = new OpenAI({
  apiKey: CEREBRAS_API_KEY,
  baseURL: 'https://api.cerebras.ai/v1',
});

// Nvidia NIM Client
const nvidia = new OpenAI({
  apiKey: NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

// Helper to extract content between headers
function extractSection(text: string, startHeader: string, endMarker: string = '#'): string {
  const startIndex = text.indexOf(startHeader);
  if (startIndex === -1) return '';
  
  const contentStart = startIndex + startHeader.length;
  const contentEnd = text.indexOf(endMarker, contentStart);
  
  if (contentEnd === -1) return text.slice(contentStart).trim();
  return text.slice(contentStart, contentEnd).trim();
}

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

// BALANCED Chain-of-thought prompts for manipulation detection
// Key fix: First determine if content IS commercial/marketing before analyzing for manipulation

const CONTENT_UNDERSTANDING_PROMPT = `You are an objective analyst. Your task is to understand and classify this Instagram Reel content WITHOUT assuming it is advertising or commercial.

REEL DESCRIPTION/CAPTION:
{description}

AUDIO TRANSCRIPTION:
{transcription}

IMAGE CONTEXT (Visual Analysis):
{image_analysis}

## STEP 1: CONTENT TYPE CLASSIFICATION (CRITICAL)

First, determine what TYPE of content this is using ALL available context (Text + Visuals). Be objective - NOT all Reels are ads:

**Is this COMMERCIAL/MARKETING content?** Answer YES only if:
- A specific product, brand, or service is being explicitly promoted (visually or verbally)
- There's a clear call-to-action to purchase, subscribe, or use a code
- There are affiliate links, promo codes, or sponsor mentions
- The content is clearly a product review, unboxing, or paid promotion

**Or is this NON-COMMERCIAL content?** Such as:
- Personal vlogs, day-in-my-life content
- Entertainment, comedy, dance, music
- Educational content without product promotion
- Opinions/rants not tied to selling something
- Travel, food, or lifestyle sharing WITHOUT commercial intent
- Relationship, motivation, or story-telling content

## STEP 2: IF COMMERCIAL - Analyze:
1. What product/service/brand is being promoted?
2. What claims are being made?
3. Are there disclosures (#ad, #sponsored)?
4. What's the call-to-action?

## STEP 3: IF NON-COMMERCIAL - Note:
- Content does not appear to be advertising
- No commercial intent detected
- Standard social media content sharing

## STEP 4: VISUAL CONTEXT SUMMARY (CRITICAL FOR NEXT STEPS)
- Summarize key visual elements from the provided Image Analysis that are relevant to this classification.
- This summary will be used for further analysis, so include the key visual elements required for the next steps.

Be HONEST in your classification. Not every social media content is advertising.`;

const MANIPULATION_INDICATORS_PROMPT = `You are a fair and balanced analyst. Based on the previous content analysis, determine if manipulation indicators are present.

**CRITICAL FIRST STEP:**
If the previous analysis determined this is NON-COMMERCIAL content (personal vlog, entertainment, education without product promotion), then:
- Most manipulation categories DO NOT APPLY
- Standard persuasion in non-commercial content is NOT manipulation
- Someone sharing opinions is NOT manipulation
- Emotional content is NOT automatically manipulation

Only analyze for manipulation if there IS commercial/marketing intent.

PREVIOUS ANALYSIS:
{previous_analysis}

REEL DESCRIPTION/CAPTION:
{description}



---

## FOR NON-COMMERCIAL CONTENT:
If the content is NOT promoting a product/service/brand, respond:
"This content appears to be non-commercial (personal/entertainment/educational). Manipulation indicators related to advertising and marketing do not apply. No commercial manipulation detected."

---

## FOR COMMERCIAL/MARKETING CONTENT ONLY:
Analyze these categories. Rate as: NOT DETECTED / MILD / MODERATE / SEVERE

### 1. DECEPTIVE CLAIMS
- Exaggerated benefits without evidence
- Unrealistic promises ("miracle", "guaranteed")
- Cherry-picked or fake results

### 2. DISCLOSURE ISSUES (FTC Compliance)
- Missing #ad or sponsorship disclosure when promoting a product
- Hidden or buried disclosures
- Undisclosed affiliate relationships

### 3. PSYCHOLOGICAL PRESSURE TACTICS
- False scarcity ("only 5 left!")
- Artificial urgency ("24 hours only!")
- Heavy FOMO language ("everyone has this")

### 4. EMOTIONAL EXPLOITATION
- Targeting insecurities for selling
- Guilt-tripping related to purchases
- Fear-based selling tactics
- Using extreme confirm-shaming
- Leveraging a fabricated intimate bond

### 5. MISINFORMATION
- False health/financial claims
- Unverified product claims

### 6. VISUAL DECEPTION (in product contexts)
- Misleading before/after
- Product misrepresentation
- Exaggerate the efficacy of a physical product or service

---

## HARM POTENTIAL ASSESSMENT (Final Analysis Point)
Analyze if this content poses specific risks:
- Financial: Could viewers lose money?
- Psychological: Is content exploiting vulnerabilities?
- Health: Unverified claims?

## INSTRUCTION: SEVERITY RATING GUIDELINES
Apply these guidelines to determine your severity rating (Mild/Moderate/Severe):
- NONE/LOW: Non-commercial OR honest commercial content & Standard marketing without deceptive tactics
- MODERATE: Missing disclosures, Some exaggerated claims, Mild pressure tactics
- SEVERE: Multiple deceptive tactics, targeting vulnerable groups with false claims, complete lack of disclosure with aggressive selling

Be fair and evidence-based. Provide quotes when claiming manipulation.`;

const FINAL_VERDICT_PROMPT = `You are the final reviewer. Based on ALL previous analysis, provide a FAIR and BALANCED verdict.

## CRITICAL CLASSIFICATION LOGIC:

**NOT MANIPULATIVE** - Use this verdict when:
- Content is non-commercial (personal, entertainment, educational)
- Commercial content with proper disclosures (#ad, sponsored)
- Honest product opinions even if enthusiastic
- No deceptive claims or pressure tactics
- Standard content creation without commercial exploitation

**MANIPULATIVE - MILD** - Use this verdict when:
- Commercial content with minor disclosure issues
- Some exaggerated claims but not severe
- Mild pressure tactics present
- Ambiguous commercial intent

**MANIPULATIVE - MODERATE** - Use this verdict when:
- Clearly promotional with missing disclosures
- Moderate exaggeration or pressure tactics
- Some use of dark patterns

**MANIPULATIVE - SEVERE** - Use this verdict ONLY when:
- Clear undisclosed commercial content
- Multiple deceptive tactics combined
- Deliberate exploitation of vulnerabilities
- Severe false claims or pressure tactics
- Targeting vulnerable populations deceptively

CONTENT SUMMARY:
{content_summary}

MANIPULATION INDICATORS (Including Severity Assessment):
{indicators}



REEL DESCRIPTION:
{description}

---

Deliver your verdict in EXACTLY this JSON format:

{
  "verdict": "[MANIPULATIVE - SEVERE | MANIPULATIVE - MODERATE | MANIPULATIVE - MILD | NOT MANIPULATIVE]",
  "confidence": "[HIGH | MEDIUM | LOW]",
  "categories": ["list categories only if manipulation detected, otherwise empty array"],
  "reasoning": "Explain your verdict. If NOT MANIPULATIVE, explain why the content is genuine/acceptable. Be specific about what you observed in text AND visuals.",
  "recommendations": "For NOT MANIPULATIVE: Note it's safe to view. For others: Specific advice for viewers."
}

**REMEMBER:**
- Most social media content is NOT manipulative
- Personal content sharing is NOT manipulation
- Enthusiasm is NOT deception
- Only deliberate commercial deception with harm potential warrants "MANIPULATIVE" variants
- When in doubt, lean toward "NOT MANIPULATIVE" or "MANIPULATIVE - MILD"`;

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
    // Runs FIRST to provide context for downstream text analysis steps
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

    console.log(`Step 2: Understanding and classifying content using ${selectedModel}...`);
    const contentPrompt = CONTENT_UNDERSTANDING_PROMPT
      .replace('{transcription}', transcription || '[No audio transcription available]')
      .replace('{description}', descriptionText)
      .replace('{image_analysis}', imageAnalysis);

    const contentSummary = await callLLM(contentPrompt, selectedModel);

    console.log(`Step 3: Identifying manipulation indicators using ${selectedModel}...`);
    const indicatorsPrompt = MANIPULATION_INDICATORS_PROMPT
      .replace('{previous_analysis}', contentSummary)
      .replace('{description}', descriptionText);

    const manipulationIndicators = await callLLM(indicatorsPrompt, selectedModel);

    console.log(`Step 4: Generating final verdict using ${selectedModel}...`);
    const verdictPrompt = FINAL_VERDICT_PROMPT
      .replace('{content_summary}', contentSummary)
      .replace('{indicators}', manipulationIndicators)
      .replace('{description}', descriptionText);

    const verdictText = await callLLM(verdictPrompt, selectedModel);

    // Parse the final verdict JSON
    let finalVerdict;
    try {
      const jsonMatch = verdictText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        finalVerdict = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in verdict response');
      }
    } catch (parseError) {
      console.error('Failed to parse verdict JSON:', parseError);
      finalVerdict = {
        verdict: 'NOT MANIPULATIVE',
        confidence: 'LOW',
        categories: [],
        reasoning: verdictText,
        recommendations: 'Unable to parse structured verdict. Please review analysis above.',
      };
    }

    // Extract fields for logging
    const isNonCommercial = contentSummary.includes("NON-COMMERCIAL") || contentSummary.includes("No commercial intent");
    const contentType = isNonCommercial ? "Non-Commercial" : "Commercial";
    
    // Attempt to extract product category (Line starting with "1. ")
    const productMatch = contentSummary.match(/1\.\s+(.*?)(\n|$)/);
    const productCategory = productMatch ? productMatch[1] : (isNonCommercial ? "N/A" : "Unknown");

    // Extract Visual Summary (Step 4 in Content Understanding)
    const visualSummary = extractSection(contentSummary, "STEP 4: VISUAL CONTEXT SUMMARY (CRITICAL FOR NEXT STEPS)", "Be HONEST");

    // Extract Harm Assessment (from Indicators)
    const harmAssessment = extractSection(manipulationIndicators, "HARM POTENTIAL ASSESSMENT (Final Analysis Point)", "INSTRUCTION:");

    // Log to Google Sheet (Fire and forget)
    const logData = {
      timestamp: new Date().toISOString(),
      video_url: url || "N/A",
      caption: reelDescription || "",
      audio_transcription: transcription || "",
      duration_seconds: duration || 0,
      uploader_name: uploaderName || "",
      reel_title: reelTitle || "",
      content_type: contentType,
      product_category: productCategory,
      visual_summary: visualSummary,
      manipulation_verdict: finalVerdict.verdict,
      severity_level: finalVerdict.verdict.replace("MANIPULATIVE - ", "").replace("NOT MANIPULATIVE", "NONE"),
      confidence_score: finalVerdict.confidence,
      detected_categories: finalVerdict.categories.join(", "),
      harm_assessment: harmAssessment,
      reasoning_summary: finalVerdict.reasoning,
      model_version: selectedModel === 'cerebras-native' ? "Cerebras GPT-OSS-120B + Gemma 3 27B" : `Nvidia NIM: ${selectedModel} + Gemma 3 27B`
    };

    if (GOOGLE_SHEET_SCRIPT_URL) {
      logToGoogleSheet(logData).catch(e => console.error("Logging failed:", e));
    } else {
      console.warn("GOOGLE_SHEET_SCRIPT_URL not set, skipping logging.");
    }

    return NextResponse.json({
      contentSummary,
      manipulationIndicators,
      imageAnalysis, // Still return it for UI display
      finalVerdict,
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
