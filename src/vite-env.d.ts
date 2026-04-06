/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  /** When "true", POST /api/generate-postcard instead of calling Gemini from the browser. */
  readonly VITE_USE_GEMINI_PROXY?: string;
  /** Optional API origin (no trailing slash). Empty = same origin (Vite dev proxies /api to GEMINI_PROXY_PORT). */
  readonly VITE_GEMINI_BACKEND_URL?: string;
  /**
   * Cloudflare Worker base that proxies v1beta (e.g. https://ai.alexsora.xyz). When set with VITE_USE_GEMINI_PROXY,
   * the app calls POST .../v1beta/models/...:generateContent (no /api route). CORS must allow your static origin.
   */
  readonly VITE_GEMINI_WORKER_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
