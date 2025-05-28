import { GoogleGenAI, GenerateContentResponse, Part } from '@google/genai';
import { OpenAI } from 'openai';
import logger from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// --- Provider selection from env ---
const VISION_PROVIDER = process.env.VISION_PROVIDER?.toLowerCase() || 'gemini';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy-gemini-key-for-testing';
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-1.5-flash-latest';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'dummy-openai-key-for-testing';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

// Flag to indicate if we're using dummy keys (for testing/development)
const IS_USING_DUMMY_KEYS =
  (VISION_PROVIDER === 'gemini' && GEMINI_API_KEY === 'dummy-gemini-key-for-testing') ||
  (VISION_PROVIDER === 'openai' && OPENAI_API_KEY === 'dummy-openai-key-for-testing');

// --- Gemini enums (as per SDK) ---
enum HarmCategory {
  HARASSMENT = 'HARM_CATEGORY_HARASSMENT',
  HATE_SPEECH = 'HARM_CATEGORY_HATE_SPEECH',
  SEXUALLY_EXPLICIT = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  DANGEROUS_CONTENT = 'HARM_CATEGORY_DANGEROUS_CONTENT'
}

enum HarmBlockThreshold {
  BLOCK_LOW_AND_ABOVE = 'BLOCK_LOW_AND_ABOVE',
  BLOCK_MEDIUM_AND_ABOVE = 'BLOCK_MEDIUM_AND_ABOVE',
  BLOCK_ONLY_HIGH = 'BLOCK_ONLY_HIGH',
  BLOCK_NONE = 'BLOCK_NONE'
}

// --- Main analyzeImage function ---
export async function analyzeImage({
  prompt,
  imageBuffer,
  mimeType,
  model
}: {
  prompt: string,
  imageBuffer?: Buffer,
  mimeType?: string,
  model?: string
}): Promise<string | null> {
    try {
    logger.info(`[llmApis] Effective VISION_PROVIDER: '${VISION_PROVIDER}' (length: ${VISION_PROVIDER.length})`);

    // If using dummy keys, return a mock response
    if (IS_USING_DUMMY_KEYS) {
      logger.warn(`[llmApis] Using dummy API keys. Returning mock response for testing.`);
      return generateMockResponse(prompt, imageBuffer ? true : false);
    }

    if (VISION_PROVIDER === 'gemini') {
      if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
      const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const modelName = model || GEMINI_VISION_MODEL;

      const requestParts: Part[] = [{ text: prompt }];
      if (imageBuffer && mimeType) {
        requestParts.push({ inlineData: { mimeType, data: imageBuffer.toString('base64') } });
      }

      const geminiResponse: GenerateContentResponse = await genAI.models.generateContent({
        model: modelName,
        contents: requestParts,
      });

      let textOutput: string | null = null;

      if (typeof (geminiResponse as any).text === 'function') {
        textOutput = (geminiResponse as any).text();
      }
      else if (typeof (geminiResponse as any).text === 'string') {
        textOutput = (geminiResponse as any).text;
      }
      else if (geminiResponse.candidates && geminiResponse.candidates.length > 0) {
        const candidate = geminiResponse.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          const textParts = candidate.content.parts
            .map(part => (part as {text?: string}).text)
            .filter(Boolean);
          if (textParts.length > 0) {
            textOutput = textParts.join(' ').trim();
          }
        }
      }
      return textOutput ? textOutput.trim() : null;
    } else if (VISION_PROVIDER === 'openai') {
      if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
      const modelName = model || OPENAI_VISION_MODEL;
      let messages: any[];
      if (imageBuffer && mimeType) {
        const base64Image = imageBuffer.toString('base64');
        messages = [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ];
      } else {
        messages = [
          { role: 'user', content: prompt }
        ];
     }
      const response = await openai.chat.completions.create({
        model: modelName,
        messages,
        max_tokens: 4000
      });
      if (response.choices && response.choices.length > 0) {
        return response.choices[0].message?.content?.trim() || null;
      }
      return null;
       } else {
      throw new Error(`Unknown VISION_PROVIDER: ${VISION_PROVIDER}`);
    }
  } catch (err: any) {
    logger.error({ err }, `analyzeImage error for provider ${VISION_PROVIDER}: ${err.message || err}`);
    return null;
  }
}

/**
 * Generate a mock response for testing when API keys are not available
 */
function generateMockResponse(prompt: string, hasImage: boolean): string {
  // Check if the prompt is asking for JSON
  const isJsonRequest = prompt.toLowerCase().includes('json') || prompt.includes('{') || prompt.includes('[');

  if (isJsonRequest) {
    return `{
      "document_content": "This is a mock document content for testing purposes.",
      "document_structure": {
        "title": "Mock Document",
        "sections": [
          {
            "heading": "Section 1",
            "content": "This is the content of section 1."
          },
          {
            "heading": "Section 2",
            "content": "This is the content of section 2."
          }
        ]
      },
      "image_descriptions": [
        {
          "image_id": 1,
          "description": "This is a mock image description for testing."
        }
      ]
    }`;
  } else if (prompt.toLowerCase().includes('markdown')) {
    return `# Mock Document

## Section 1
This is the content of section 1.

## Section 2
This is the content of section 2.

![Image 1](image1.jpg)
This is a mock image description for testing.
`;
  } else if (prompt.toLowerCase().includes('html')) {
    return `<h1>Mock Document</h1>
<h2>Section 1</h2>
<p>This is the content of section 1.</p>
<h2>Section 2</h2>
<p>This is the content of section 2.</p>
<figure>
  <img src="image1.jpg" alt="Image 1">
  <figcaption>This is a mock image description for testing.</figcaption>
</figure>`;
  } else {
    return `Mock Document

Section 1
This is the content of section 1.

Section 2
This is the content of section 2.

[Image 1]
This is a mock image description for testing.`;
  }
}