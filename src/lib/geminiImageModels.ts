/**
 * Models that actually emit image bytes (inlineData) for image+text → image.
 * Text/multimodal IDs like gemini-*-flash-preview or *-flash-lite-preview return
 * prose, not postcards — you will see "No image in response".
 */
export const POSTCARD_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
] as const;
