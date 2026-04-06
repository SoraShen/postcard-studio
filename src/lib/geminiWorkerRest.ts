import {
  formatGenaiError,
  modelsForPostcardImageSize,
  pickInlineImageFromResponse,
  type PostcardImageSize,
} from './geminiPostcardGeneration';

type GenContentResponse = Parameters<typeof pickInlineImageFromResponse>[0];

/**
 * Calls Gemini via your Cloudflare Worker (same host as v1beta), no API key in the browser.
 * POST {workerBase}/v1beta/models/{model}:generateContent — Worker injects key upstream.
 */
export async function runGeminiPostcardViaWorkerRest(
  workerBase: string,
  input: { imageBase64: string; mimeType: string; prompt: string; imageSize?: PostcardImageSize }
): Promise<string> {
  const base = workerBase.replace(/\/$/, '');
  let lastErr: unknown;
  let resultDataUrl: string | null = null;

  const tryModel = async (model: string, requestImageModality: boolean): Promise<boolean> => {
    const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
                { text: input.prompt },
              ],
            },
          ],
          generationConfig: {
            ...(requestImageModality ? { responseModalities: ['IMAGE'] } : {}),
            imageConfig: { imageSize: input.imageSize ?? '1K' },
          },
        }),
      });

      const text = await res.text();
      let json: GenContentResponse & { error?: { message?: string; code?: number } };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        lastErr = new Error(text.slice(0, 300));
        return false;
      }

      if (!res.ok) {
        const msg = json?.error?.message || text.slice(0, 300);
        lastErr = new Error(msg);
        return false;
      }

      const img = pickInlineImageFromResponse(json);
      if (img) {
        resultDataUrl = `data:${img.mimeType};base64,${img.data}`;
        return true;
      }

      const fr = json.candidates?.[0]?.finishReason;
      lastErr = new Error(
        fr ? `No image in response (finishReason: ${fr}).` : 'No image in response (empty candidates or parts).'
      );
    } catch (e) {
      lastErr = e;
      console.warn(`[postcard] worker REST model=${model}`, formatGenaiError(e));
    }
    return false;
  };

  const models = modelsForPostcardImageSize(input.imageSize);
  outer: for (const withImage of [true, false] as const) {
    for (const model of models) {
      if (await tryModel(model, withImage)) break outer;
    }
  }

  if (!resultDataUrl) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error(
          lastErr != null ? formatGenaiError(lastErr) : 'No image returned. Check Worker and billing.'
        );
  }

  return resultDataUrl;
}
