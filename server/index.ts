import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {
  runGeminiPostcardGeneration,
  formatGenaiError,
  type PostcardImageSize,
} from '../src/lib/geminiPostcardGeneration.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const PORT = Number(process.env.GEMINI_PROXY_PORT || 8787);
const apiKey = (process.env.GEMINI_API_KEY || '').trim();

const allowedOrigins = (process.env.GEMINI_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(express.json({ limit: '20mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.post('/api/generate-postcard', async (req, res) => {
  if (!apiKey) {
    res.status(503).json({ error: 'Server missing GEMINI_API_KEY.' });
    return;
  }

  const body = req.body as {
    prompt?: string;
    mimeType?: string;
    imageBase64?: string;
    imageSize?: string;
  };

  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const rawSize = typeof body.imageSize === 'string' ? body.imageSize : '';
  const imageSize: PostcardImageSize | undefined =
    rawSize === '512' || rawSize === '1K' || rawSize === '2K' || rawSize === '4K' ? rawSize : undefined;

  if (!prompt || !mimeType || !imageBase64) {
    res.status(400).json({ error: 'Missing prompt, mimeType, or imageBase64.' });
    return;
  }

  try {
    const dataUrl = await runGeminiPostcardGeneration(apiKey, {
      imageBase64,
      mimeType,
      prompt,
      ...(imageSize ? { imageSize } : {}),
    });
    res.json({ dataUrl });
  } catch (e) {
    console.error('[generate-postcard]', formatGenaiError(e));
    res.status(502).json({ error: formatGenaiError(e) });
  }
});

/** Optional: serve Vite build from same process in production */
if (process.env.SERVE_STATIC === 'true') {
  const dist = path.join(projectRoot, 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Gemini proxy listening on http://127.0.0.1:${PORT}`);
  if (allowedOrigins.length) {
    console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
  }
});
