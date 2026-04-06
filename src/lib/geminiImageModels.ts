/**
 * Image models for postcard generation — fastest first.
 * Pro preview is omitted by default (slower); add here if you need max quality.
 */
export const POSTCARD_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
] as const;
