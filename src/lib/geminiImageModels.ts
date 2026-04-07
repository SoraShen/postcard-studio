/**
 * Models that actually emit image bytes (inlineData) for image+text → image.
 * Text/multimodal IDs like gemini-*-flash-preview or *-flash-lite-preview return
 * prose, not postcards — you will see "No image in response".
 */
/** Faster model first; 2.5 as fallback if 3.1 errors or quota. */
export const POSTCARD_IMAGE_MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
] as const;
