import { GoogleGenAI, Modality } from '@google/genai';
import { POSTCARD_IMAGE_MODELS } from './geminiImageModels';

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

/**
 * Two-phase calls: all models with IMAGE modality first, then all without.
 * Faster when an early model succeeds with IMAGE (skips slower fallbacks per model).
 */
export async function runGeminiPostcardGeneration(
  apiKey: string,
  input: { imageBase64: string; mimeType: string; prompt: string }
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  let lastErr: unknown;
  let resultDataUrl: string | null = null;

  const tryModel = async (model: string, requestImageModality: boolean): Promise<boolean> => {
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
        return false;
      }

      const img = pickInlineImageFromResponse(response);
      if (img) {
        resultDataUrl = `data:${img.mimeType};base64,${img.data}`;
        return true;
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
    return false;
  };

  outer: for (const withImage of [true, false] as const) {
    for (const model of POSTCARD_IMAGE_MODELS) {
      if (await tryModel(model, withImage)) break outer;
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
