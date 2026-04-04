import { GoogleGenAI, Modality } from '@google/genai';

export function formatGenaiError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/** First inline image part in any candidate — avoids crashing when content.parts is missing. */
export function pickInlineImageFromResponse(response: {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
}): { data: string; mimeType: string } | null {
  if (response.promptFeedback?.blockReason) return null;
  const cands = response.candidates;
  if (!cands?.length) return null;
  for (const c of cands) {
    const parts = c.content?.parts;
    if (!parts) continue;
    for (const p of parts) {
      const id = p.inlineData;
      if (id?.data && id.mimeType?.startsWith('image/')) {
        return { data: id.data, mimeType: id.mimeType };
      }
    }
  }
  return null;
}

const MODELS_TO_TRY = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
] as const;

/**
 * Calls Gemini image models with the same retry strategy as the postcard app.
 * @throws Error when no image is produced
 */
export async function runGeminiPostcardGeneration(
  apiKey: string,
  input: { imageBase64: string; mimeType: string; prompt: string }
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  let lastErr: unknown;
  let resultDataUrl: string | null = null;

  outer: for (const model of MODELS_TO_TRY) {
    for (const requestImageModality of [true, false] as const) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: {
            role: 'user',
            parts: [
              { inlineData: { data: input.imageBase64, mimeType: input.mimeType } },
              { text: input.prompt },
            ],
          },
          config: {
            ...(requestImageModality ? { responseModalities: [Modality.IMAGE] } : {}),
            imageConfig: { imageSize: '1K' },
          },
        });

        const blockReason = response.promptFeedback?.blockReason;
        if (blockReason) {
          lastErr = new Error(
            `Prompt blocked (${blockReason})${response.promptFeedback?.blockReasonMessage ? `: ${response.promptFeedback.blockReasonMessage}` : ''}`
          );
          continue;
        }

        const img = pickInlineImageFromResponse(response);
        if (img) {
          resultDataUrl = `data:${img.mimeType};base64,${img.data}`;
          break outer;
        }

        const fr = response.candidates?.[0]?.finishReason;
        lastErr = new Error(
          fr
            ? `No image in response (finishReason: ${fr}).`
            : 'No image in response (empty candidates or parts).'
        );
      } catch (e) {
        lastErr = e;
        console.warn(
          `[postcard] model=${model} imageModality=${requestImageModality}`,
          formatGenaiError(e)
        );
      }
    }
  }

  if (!resultDataUrl) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error(
          lastErr != null ? formatGenaiError(lastErr) : 'No image returned. Check API access and billing.'
        );
  }

  return resultDataUrl;
}
