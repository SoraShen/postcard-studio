/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  /** When "true", POST /api/generate-postcard instead of calling Gemini from the browser. */
  readonly VITE_USE_GEMINI_PROXY?: string;
  /** Optional API origin (no trailing slash). Empty = same origin (Vite dev proxies /api to GEMINI_PROXY_PORT). */
  readonly VITE_GEMINI_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
