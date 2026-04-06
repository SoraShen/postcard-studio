<div align="center">
<img width="1200" height="475" alt="Postcard Studio" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Postcard Studio

AI-powered holiday postcard generator: upload a photo, pick a theme and style, and generate a stylized postcard with Gemini image models. Built with **Vite 6**, **React 19**, **TypeScript**, and **Tailwind CSS**.

Original AI Studio app: [open in AI Studio](https://ai.studio/apps/3e879f5f-acaf-443f-9905-44c9a3359d11).

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (20 LTS recommended)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key for Gemini

---

## Quick start

```bash
npm install
```

Copy `.env.example` to `.env` in the **project root** and set your key (see below). Then:

```bash
npm run dev
```

Open the URL shown in the terminal (default [http://localhost:3000](http://localhost:3000)).

---

## 每次更新：本地提交 + 服务器构建

**本机（在项目根目录）**

```bash
git add .
git commit -m "简要说明本次修改"
git push origin main
```

若主分支名为 `master`，将最后一行改为 `git push origin master`。

**服务器（静态站 + Cloudflare Worker 代调 API 时）**

```bash
cd /www/wwwroot/alexsora.xyz
# 若构建报 dist/.user.ini EPERM（宝塔）：
chattr -i dist/.user.ini 2>/dev/null; rm -f dist/.user.ini

git pull
npm install
VITE_USE_GEMINI_PROXY=true VITE_GEMINI_WORKER_BASE=https://ai.alexsora.xyz npm run build
```

按你的实际路径与 Worker 域名替换 `cd` 与 `VITE_GEMINI_WORKER_BASE`。

---

## Environment variables

All variables are documented in [`.env.example`](.env.example).

| Variable | When to use |
|----------|-------------|
| `GEMINI_API_KEY` | Local dev (injected by Vite) **or** backend server only in production — **do not** expose this in public front-end builds. |
| `VITE_GEMINI_API_KEY` | Optional; same as above for browser-side dev only — **avoid** for public sites. |
| `VITE_USE_GEMINI_PROXY` | Set to `true` so the app uses a backend/Worker instead of calling Gemini from the browser. **Required in `npm run build`** for production. |
| `VITE_GEMINI_WORKER_BASE` | e.g. `https://ai.alexsora.xyz` — calls `.../v1beta/models/...:generateContent` via your Worker (no trailing slash). |
| `VITE_GEMINI_BACKEND_URL` | Optional; use with `POST /api/generate-postcard` on your origin when not using `VITE_GEMINI_WORKER_BASE`. |
| `APP_URL` | Optional; base URL for links and callbacks when hosted. |

**Never commit `.env`** — it is listed in `.gitignore`.

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server on port 3000. |
| `npm run server` | Express proxy + optional static hosting (`SERVE_STATIC=true`). Default port **8787** (`GEMINI_PROXY_PORT`). |
| `npm run dev:all` | Runs `server` and `dev` together (with `/api` proxied to the server in `vite.config.ts`). |
| `npm run build` | Production build to `dist/`. Use `VITE_USE_GEMINI_PROXY=true npm run build` when the live site uses the backend proxy. |
| `npm start` | Start the Express app (production: set `SERVE_STATIC=true` and `GEMINI_API_KEY` on the host). |
| `npm run preview` | Preview the built static app. |
| `npm run lint` | Typecheck with `tsc --noEmit`. |

---

## Gemini: browser vs backend proxy

**Browser (default for local dev)**  
The client calls Gemini directly. You need a key in `.env` (`GEMINI_API_KEY` or `VITE_GEMINI_API_KEY`). The key can end up in the bundle if you use `VITE_*` — fine for local use, **not** ideal for public production.

**Backend proxy (recommended for production)**  
1. Set `VITE_USE_GEMINI_PROXY=true` when you run **`npm run build`**.  
2. On the server, set **`GEMINI_API_KEY` only** (no `VITE_` prefix for the secret).  
3. Run `npm start` with `SERVE_STATIC=true` so Express serves `dist/` and handles `/api/generate-postcard`.  
4. Point your reverse proxy (e.g. Nginx) at `http://127.0.0.1:8787` (or your `GEMINI_PROXY_PORT`).

For cross-origin frontends, set `GEMINI_ALLOWED_ORIGINS` on the server (comma-separated) and `VITE_GEMINI_BACKEND_URL` at build time if the API lives on another host.

---

## Production deploy (overview)

1. Clone the repo on the server and `cd` into the project directory.  
2. Create `.env` with at least:

   ```env
   GEMINI_API_KEY=your_key
   SERVE_STATIC=true
   ```

3. Install and build:

   ```bash
   npm install --production
   VITE_USE_GEMINI_PROXY=true npm run build
   ```

4. Keep the process alive (e.g. **PM2**): `pm2 start npm --name postcard-studio -- start`  
5. Configure **Nginx** (or your panel) to reverse-proxy your domain to `http://127.0.0.1:8787`.  
6. Add HTTPS (e.g. Let’s Encrypt) when ready.

Do **not** open port `8787` to the public internet if the reverse proxy runs on the same machine; only **80/443** need to be public.

---

## Image generation speed

The app tries **image output** models in order (`gemini-2.5-flash-image`, then `gemini-3.1-flash-image-preview` on failure) in two phases: **with** `responseModalities: IMAGE` for all models, then **without**. List is in [`src/lib/geminiImageModels.ts`](src/lib/geminiImageModels.ts). Output **`imageSize`** is **`1K`** when the postcard text is Chinese (UI or copy contains Han characters); **English-only** sessions use **`512`** (smaller/cheaper), which only works on `gemini-3.1-flash-image-preview`, so the model chain is narrowed automatically — see `modelsForPostcardImageSize` in [`src/lib/geminiPostcardGeneration.ts`](src/lib/geminiPostcardGeneration.ts).

Further gains: smaller source images before upload, stable network, and billing/quota on the Google project.

---

## Animated GIF from a static postcard?

**Gemini image models** (e.g. Nano Banana / `gemini-*-flash-image`) output **static images** (PNG), not GIF.

For **AI motion** from an image or prompt, Google’s side is mainly **video** APIs such as **Veo** (`veo-*` in the model list) — you would generate a **short video**, then convert to GIF with **ffmpeg** or a small server job. That is a separate product path (latency, quota, and pricing differ from image generation).

Other options: third-party **image-to-video** APIs, or **client-only** animation (e.g. **gif.js**, CSS/canvas loops) for lightweight effects without a new model.

---

> **Note:** After each change in this repo, use the **「每次更新」** commands above for commit and server build.
