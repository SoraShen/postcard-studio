/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, ChangeEvent, useCallback, type MouseEvent, type TouchEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Cropper, { Area, Point } from 'react-easy-crop';
import { 
  Upload, 
  ChevronDown, 
  Send, 
  RefreshCw, 
  Sparkles, 
  Image as ImageIcon,
  Mail,
  ArrowRight,
  CheckCircle2,
  Crop,
  Check
} from 'lucide-react';
import { formatGenaiError, runGeminiPostcardGeneration } from "@/src/lib/geminiPostcardGeneration";
import { runGeminiPostcardViaWorkerRest } from "@/src/lib/geminiWorkerRest";
import { PostcardAmbientParticles } from "@/src/components/PostcardAmbientParticles";

// --- Types & Globals ---

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type Holiday = {
  id: string;
  name: string;
  zhName: string;
  emoji: string;
  theme: string;
  bgColor: string;
  accentColor: string;
  greeting: string;
  shortBlessing: string;
  zhShortBlessing: string;
  elements: string;
  placeholder?: string;
  zhPlaceholder?: string;
};

type Style = {
  id: string;
  name: string;
  zhName: string;
  description: string;
  promptSuffix: string;
};

const STYLES: Style[] = [
  {
    id: 'watercolor',
    name: 'Watercolor',
    zhName: '水彩',
    description: 'Soft, artistic watercolor painting',
    promptSuffix: 'high-end watercolor painting'
  },
  {
    id: 'pixel',
    name: 'Pixel Art',
    zhName: '像素风',
    description: 'Retro, Stardew Valley style pixel art',
    promptSuffix: 'Stardew Valley style pixel art, retro 16-bit aesthetic, vibrant colors, charming details'
  },
  {
    id: 'ghibli',
    name: 'Studio Ghibli',
    zhName: '宫崎骏',
    description: 'Whimsical, vibrant anime style',
    promptSuffix: 'Studio Ghibli anime style, vibrant colors, whimsical atmosphere, hand-painted background'
  }
];

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

function parseDataUrlImage(dataUrl: string): { base64: string; mimeType: string } | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (m) return { mimeType: m[1].trim(), base64: m[2].trim() };
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const header = dataUrl.slice(0, comma);
  const mimeMatch = header.match(/^data:([^;,]+)/);
  return {
    mimeType: (mimeMatch?.[1] ?? 'image/jpeg').trim(),
    base64: dataUrl.slice(comma + 1).trim(),
  };
}

function hasChineseChars(str: string): boolean {
  return /[\u4e00-\u9fff]/.test(str);
}

/** Downscale JPEG for API only — preview/crop use full-quality URLs. */
const API_INPUT_MAX_DIM = 1024;
const API_JPEG_QUALITY = 0.72;
/** Safety cap for cropped preview canvas (memory). */
const MAX_PREVIEW_CROP_DIM = 4096;

async function compressImageDataUrlForApi(dataUrl: string): Promise<string> {
  try {
    const img = await createImage(dataUrl);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w <= 0 || h <= 0) return dataUrl;
    if (w > API_INPUT_MAX_DIM || h > API_INPUT_MAX_DIM) {
      const scale = API_INPUT_MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', API_JPEG_QUALITY);
  } catch {
    return dataUrl;
  }
}

async function ensureXingshuFontsLoaded(): Promise<void> {
  try {
    await document.fonts.load("400 64px 'Long Cang'");
    await document.fonts.load("400 64px 'Zhi Mang Xing'");
  } catch {
    /* ignore */
  }
}

function wrapCjkLinesCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  fontSpec: string
): string[] {
  ctx.font = fontSpec;
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** 行书叠字 — 与明信片正面 DOM 叠加一致，供下载合成 */
function drawPostcardFrontTextOverlay(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  w: number,
  h: number,
  title: string,
  blessing: string,
  textSizeUi: number,
  positionPct: { x: number; y: number }
) {
  const cx = offsetX + (w * positionPct.x) / 100;
  const cy = offsetY + (h * positionPct.y) / 100;
  const titlePx = Math.max(22, Math.round((textSizeUi / 48) * h * 0.1));
  const subPx = Math.max(15, Math.round(titlePx * 0.5));
  const fontTitle = `${titlePx}px "Long Cang", "Zhi Mang Xing", cursive`;
  const fontBless = `${subPx}px "Long Cang", "Zhi Mang Xing", cursive`;
  const maxTextW = w * 0.86;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const titleLines = title.trim() ? wrapCjkLinesCanvas(ctx, title.trim(), maxTextW, fontTitle) : [];
  const blessLines = blessing.trim()
    ? wrapCjkLinesCanvas(ctx, blessing.trim(), maxTextW, fontBless)
    : [];

  const lineGapT = titlePx * 1.2;
  const lineGapB = subPx * 1.28;
  const gapMid = titleLines.length ? titlePx * 0.4 : 0;
  const totalH = titleLines.length * lineGapT + gapMid + blessLines.length * lineGapB;
  let y = cy - totalH / 2 + lineGapT / 2;

  ctx.font = fontTitle;
  for (const ln of titleLines) {
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = Math.max(2, titlePx * 0.085);
    ctx.lineJoin = 'round';
    ctx.strokeText(ln, cx, y);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fillText(ln, cx, y);
    y += lineGapT;
  }
  y += gapMid;

  ctx.font = fontBless;
  for (const ln of blessLines) {
    ctx.strokeStyle = 'rgba(0,0,0,0.38)';
    ctx.lineWidth = Math.max(1.5, subPx * 0.075);
    ctx.strokeText(ln, cx, y);
    ctx.fillStyle = 'rgba(255,252,250,0.94)';
    ctx.fillText(ln, cx, y);
    y += lineGapB;
  }
}

type PostcardBackLabels = {
  postcardMark: string;
  postcardHint: string;
  blessingLabel: string;
  toLabel: string;
  fromLabel: string;
  stampLabel: string;
  toPlaceholder: string;
  fromPlaceholder: string;
};

function wrapMessageLinesCanvas(
  ctx: CanvasRenderingContext2D,
  body: string,
  colMsgW: number,
  cjkWrap: boolean
): string[] {
  const lines: string[] = [];
  const t = body.trim();
  if (!t) return lines;
  if (cjkWrap) {
    let line = '';
    for (const ch of t) {
      const test = line + ch;
      if (ctx.measureText(test).width > colMsgW && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  } else {
    const words = t.split(/\s+/).filter(Boolean);
    let line = '';
    for (let n = 0; n < words.length; n++) {
      const testLine = line + (line ? ' ' : '') + words[n];
      if (ctx.measureText(testLine).width > colMsgW && line) {
        lines.push(line);
        line = words[n];
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Renders the postcard back — keep layout in sync with the flip-side UI in App. */
function drawPostcardBack(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  language: 'en' | 'zh',
  holidayLabel: string,
  message: string,
  senderName: string,
  recipientName: string,
  labels: PostcardBackLabels
) {
  ctx.fillStyle = '#fffdfa';
  ctx.fillRect(0, 0, w, h);

  const padX = Math.max(12, Math.round(w * 0.056));
  const padY = Math.max(12, Math.round(h * 0.058));
  const innerW = w - padX * 2;
  const topBandH = Math.round(h * 0.09);
  const splitX = padX + Math.round(innerW * 0.577);
  const gutter = Math.max(8, Math.round(w * 0.02));
  const lineW = Math.max(1, Math.round(w * 0.002));

  const preferCjkScript =
    language === 'zh' || /[\u4e00-\u9fff]/.test(message + senderName + recipientName);
  const scriptSize = Math.round(w * (preferCjkScript ? 0.042 : 0.038));
  const scriptFamily = preferCjkScript
    ? '"Zhi Mang Xing", "KaiTi", "STKaiti", cursive'
    : '"Dancing Script", "Brush Script MT", "Segoe Script", cursive';
  const labelSize = Math.max(10, Math.round(w * 0.021));
  const capSize = Math.max(9, Math.round(w * 0.019));

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = lineW;
  const ruleY = padY + topBandH - Math.round(h * 0.012);
  ctx.beginPath();
  ctx.moveTo(padX, ruleY);
  ctx.lineTo(w - padX, ruleY);
  ctx.stroke();

  const bodyRowTop = padY + topBandH + Math.round(h * 0.048);
  ctx.beginPath();
  ctx.moveTo(splitX, bodyRowTop);
  ctx.lineTo(splitX, h - padY);
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 ${capSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(labels.postcardMark.toUpperCase(), padX, padY + topBandH * 0.48);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = `${Math.max(9, Math.round(w * 0.017))}px ui-sans-serif, system-ui, sans-serif`;
  const hintY = padY + topBandH * 0.82;
  ctx.fillText(labels.postcardHint, padX, hintY);

  ctx.fillStyle = '#64748b';
  ctx.font = `italic ${Math.round(w * 0.032)}px ui-serif, Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'right';
  ctx.fillText(`${holidayLabel} · 2026`, w - padX, padY + topBandH * 0.52);

  const colLeft = padX;
  const colMsgW = splitX - padX - gutter / 2;
  const colR = splitX + gutter;
  const colRW = w - padX - colR;
  const fromBlockY = h - padY - Math.round(h * 0.162);
  const msgZoneBottom = fromBlockY - Math.round(h * 0.055);

  const stampW = Math.round(w * 0.138);
  const stampH = Math.round(stampW * 1.18);
  const stampX = w - padX - stampW;
  const stampY = bodyRowTop + Math.round(h * 0.014);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = lineW;
  ctx.strokeRect(stampX, stampY, stampW, stampH);
  ctx.save();
  ctx.translate(stampX + stampW / 2, stampY + stampH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = `600 ${Math.round(w * 0.016)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labels.stampLabel, 0, 0);
  ctx.restore();

  const blessingLabelY = bodyRowTop + Math.round(h * 0.006);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 ${labelSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(labels.blessingLabel, colLeft, blessingLabelY);

  const msgLineH = Math.round(scriptSize * 1.38);
  const msgZoneTop = blessingLabelY + Math.round(h * 0.056);
  const body = message.trim() || '';
  const cjkWrap = language === 'zh' || /[\u4e00-\u9fff]/.test(body);
  ctx.font = `${scriptSize}px ${scriptFamily}`;
  ctx.textBaseline = 'alphabetic';

  const cxBlessing = colLeft + colMsgW / 2;
  if (body) {
    const lines = wrapMessageLinesCanvas(ctx, body, colMsgW, cjkWrap);
    const totalH = lines.length * msgLineH;
    const avail = msgZoneBottom - msgZoneTop;
    let startY = msgZoneTop + Math.max(0, (avail - totalH) / 2) + msgLineH * 0.72;
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    for (let i = 0; i < lines.length; i++) {
      const y = startY + i * msgLineH;
      if (y > msgZoneBottom) break;
      ctx.fillText(lines[i], cxBlessing, y);
    }
  } else {
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    const ph = cjkWrap ? '……………………' : '· · · · · · · · ·';
    const avail = msgZoneBottom - msgZoneTop;
    const y = msgZoneTop + avail / 2 + msgLineH * 0.35;
    ctx.fillText(ph, cxBlessing, y);
  }

  let ry = stampY + stampH + Math.round(h * 0.058);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 ${labelSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(labels.toLabel, colR, ry);
  ry += Math.round(h * 0.042);

  const fitOneLine = (text: string) => {
    if (ctx.measureText(text).width <= colRW) return text;
    let s = text;
    while (s.length > 3 && ctx.measureText(`${s.slice(0, -1)}…`).width > colRW) s = s.slice(0, -1);
    return `${s.slice(0, -1)}…`;
  };

  ctx.fillStyle = '#334155';
  ctx.font = `${scriptSize}px ${scriptFamily}`;
  const toText = recipientName.trim() || labels.toPlaceholder;
  ctx.fillText(fitOneLine(toText), colR, ry);
  ry += Math.round(h * 0.062);

  const dividerY = Math.min(fromBlockY - Math.round(h * 0.052), ry + Math.round(h * 0.078));
  ctx.strokeStyle = '#e2e8f0';
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(colR, dividerY);
  ctx.lineTo(colR + colRW, dividerY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 ${labelSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(labels.fromLabel, colR, fromBlockY);

  ctx.fillStyle = '#334155';
  ctx.font = `${scriptSize}px ${scriptFamily}`;
  const fromText = senderName.trim() || labels.fromPlaceholder;
  ctx.fillText(fitOneLine(fromText), colR, fromBlockY + Math.round(h * 0.046));
}

const HOLIDAYS: Holiday[] = [
  { 
    id: 'custom', 
    name: 'Custom', 
    zhName: '自定义',
    emoji: '🎨',
    theme: 'Your Choice', 
    bgColor: 'bg-slate-50', 
    accentColor: 'text-slate-700',
    greeting: 'Custom',
    shortBlessing: 'Wishing you a wonderful day!',
    zhShortBlessing: '祝你度过美好的一天！',
    elements: 'artistic elements, beautiful background',
    placeholder: 'e.g., Wishing you a wonderful day!',
    zhPlaceholder: '例如：祝你度过美好的一天！'
  },
  { 
    id: 'welcome', 
    name: 'Welcome', 
    zhName: '欢迎',
    emoji: '🏠',
    theme: 'Bright & Airy', 
    bgColor: 'bg-sky-50', 
    accentColor: 'text-sky-600',
    greeting: 'Welcome',
    shortBlessing: 'May your new journey be filled with joy and warmth.',
    zhShortBlessing: '愿你的新旅程充满喜悦与温暖。',
    elements: 'open doors, warm sunlight, blooming flowers, cozy atmosphere',
    placeholder: 'e.g., Welcome to our team!',
    zhPlaceholder: '例如：欢迎加入我们的团队！'
  },
  { 
    id: 'farewell', 
    name: 'Farewell', 
    zhName: '送别',
    emoji: '👋',
    theme: 'Sunset & Soft', 
    bgColor: 'bg-violet-50', 
    accentColor: 'text-violet-700',
    greeting: 'Farewell',
    shortBlessing: 'Wishing you all the best in your next adventure.',
    zhShortBlessing: '祝你在下一次冒险中一切顺利。',
    elements: 'sunset sky, flying birds, soft clouds, nostalgic atmosphere',
    placeholder: 'e.g., We will miss you!',
    zhPlaceholder: '例如：我们会想念你的！'
  },
  { 
    id: 'lunar-new-year', 
    name: 'Lunar New Year', 
    zhName: '春节',
    emoji: '🧧',
    theme: 'Red & Gold', 
    bgColor: 'bg-red-50', 
    accentColor: 'text-red-700',
    greeting: 'Lunar New Year',
    shortBlessing: 'May the year ahead bring you prosperity and good fortune.',
    zhShortBlessing: '愿新的一年带给你繁荣与好运。',
    elements: 'red lanterns, golden dragons, cherry blossoms',
    placeholder: 'e.g., Happy New Year!',
    zhPlaceholder: '例如：新春快乐，万事如意！'
  },
  { 
    id: 'valentine', 
    name: "Valentine's Day", 
    zhName: '情人节',
    emoji: '💖',
    theme: 'Pink & Rose', 
    bgColor: 'bg-pink-50', 
    accentColor: 'text-pink-600',
    greeting: 'Valentine',
    shortBlessing: 'Sending you all my love on this special day.',
    zhShortBlessing: '在这个特别的日子里，送上我所有的爱。',
    elements: 'soft pink roses, delicate hearts, romantic atmosphere',
    placeholder: 'e.g., To my dearest...',
    zhPlaceholder: '例如：致我最亲爱的...'
  },
  { 
    id: 'easter', 
    name: 'Easter', 
    zhName: '复活节',
    emoji: '🐰',
    theme: 'Pastel & Green', 
    bgColor: 'bg-green-50', 
    accentColor: 'text-green-600',
    greeting: 'Easter',
    shortBlessing: 'Hoping your Easter is full of peace and happiness.',
    zhShortBlessing: '希望你的复活节充满和平与幸福。',
    elements: 'pastel eggs, spring flowers, cute bunnies',
    placeholder: 'e.g., Happy Easter!',
    zhPlaceholder: '例如：复活节快乐！'
  },
  { 
    id: 'mid-autumn', 
    name: 'Mid-Autumn Festival', 
    zhName: '中秋节',
    emoji: '🥮',
    theme: 'Deep Blue & Gold', 
    bgColor: 'bg-indigo-50', 
    accentColor: 'text-indigo-900',
    greeting: 'Mid-Autumn',
    shortBlessing: 'May the full moon bring you and your family together.',
    zhShortBlessing: '愿明月带给你和你的家人团圆。',
    elements: 'full moon, glowing lanterns, mooncakes',
    placeholder: 'e.g., Happy Mid-Autumn Festival!',
    zhPlaceholder: '例如：但愿人长久，千里共婵娟'
  },
  { 
    id: 'halloween', 
    name: 'Halloween', 
    zhName: '万圣节',
    emoji: '🎃',
    theme: 'Orange & Black', 
    bgColor: 'bg-orange-50', 
    accentColor: 'text-orange-700',
    greeting: 'Halloween',
    shortBlessing: 'Have a spooktacular night filled with treats and fun.',
    zhShortBlessing: '祝你有一个充满糖果和乐趣的惊悚之夜。',
    elements: 'jack-o-lanterns, spooky ghosts, autumn leaves',
    placeholder: 'e.g., Trick or Treat!',
    zhPlaceholder: '例如：不给糖就捣蛋！'
  },
  { 
    id: 'thanksgiving', 
    name: 'Thanksgiving', 
    zhName: '感恩节',
    emoji: '🦃',
    theme: 'Amber & Brown', 
    bgColor: 'bg-amber-50', 
    accentColor: 'text-amber-800',
    greeting: 'Thanksgiving',
    shortBlessing: 'Grateful for your presence in my life. Happy Thanksgiving.',
    zhShortBlessing: '感谢你出现在我的生命中。感恩节快乐。',
    elements: 'pumpkins, cornucopia, warm autumn colors',
    placeholder: 'e.g., Thankful for you!',
    zhPlaceholder: '例如：感恩有你！'
  },
  { 
    id: 'christmas', 
    name: 'Christmas', 
    zhName: '圣诞节',
    emoji: '🎄',
    theme: 'Evergreen & Red', 
    bgColor: 'bg-emerald-50', 
    accentColor: 'text-emerald-800',
    greeting: 'Christmas',
    shortBlessing: 'Wishing you a season filled with magic and wonder.',
    zhShortBlessing: '祝你度过一个充满魔力与奇迹的季节。',
    elements: 'pine branches, holly berries, twinkling lights',
    placeholder: 'e.g., Merry Christmas!',
    zhPlaceholder: '例如：圣诞快乐！'
  },
];

const TRANSLATIONS: Record<string, any> = {
  en: {
    title: "Sora's Postcard Studio",
    credits: "Credits",
    topUp: "Top Up",
    uploadPhoto: "Upload a Photo",
    dragDrop: "Drag and drop or click to browse",
    zoom: "Zoom",
    cancel: "Cancel",
    confirmCrop: "Confirm Crop",
    selectStyle: "Select Style",
    customBlessing: "Custom Blessing (Optional)",
    createCard: "Create {name} Card",
    magicalPainting: "Magical Painting...",
    aiCrafting: "AI is crafting your artistic masterpiece",
    stamp: "Stamp",
    writeMessage: "Write your personal message here...",
    postcardMark: "Postcard",
    postcardHint: "Write & share your warmth",
    blessingLabel: "Your wishes",
    toLabel: "To",
    fromLabel: "From",
    toPlaceholder: "Recipient's name",
    fromPlaceholder: "Your name",
    showFront: "Front side",
    backToStudio: "Back to Studio",
    download: "Download",
    sendByEmail: "Send by Email",
    sending: "Sending...",
    sent: "Sent!",
    enterEmail: "Enter recipient email",
    send: "Send",
    rechargeTitle: "Top Up Credits",
    rechargeDesc:
      "Each generation costs 5 credits. You start with 15 credits (~3 postcards). Pick a pack when you need more.",
    popular: "Popular",
    bestValue: "Best Value",
    customTheme: "Custom Theme",
    themePlaceholder: "e.g., Birthday, Graduation",
    blessingPlaceholder: "e.g., Happy Birthday!",
    sceneKeywords: "Scene Keywords (Optional)",
    scenePlaceholder: "e.g., A cozy cafe, rainy day, balloons",
    aspectRatio: "Ratio",
    paymentMethod: "Payment Method",
    link: "Link",
    alipay: "Alipay",
    clickToFlip: "Click to flip — add recipient, wishes & your name",
    textSize: "Text Size",
    unlockCredits: "Unlock Credits",
    enterPassword: "Enter Password",
    magicUnlocked: "Magical Credits Unlocked!",
    soraEggAlreadyUsed: "Sora easter egg credits were already claimed in this browser.",
    downloadStitched: "Download Stitched (PNG)",
    downloadHidden: "Download Hidden (Phantom Tank)",
    downloadMode: "Download Mode",
    easterEggHint: 'Double-tap "Sora" or press and hold to unlock a surprise',
    includeOccasionTitle: 'Show occasion title on the card',
    includeBlessingLine: 'Show blessing line on the card',
    cardTextHint: 'By default the image has no lettering — turn on options below to add text.',
  },
  zh: {
    title: "Sora的明信片工坊",
    credits: "积分",
    topUp: "充值",
    uploadPhoto: "上传照片",
    dragDrop: "拖拽或点击上传",
    zoom: "缩放",
    cancel: "取消",
    confirmCrop: "确认裁剪",
    selectStyle: "选择风格",
    customBlessing: "自定义祝福语（可选）",
    createCard: "生成{name}明信片",
    magicalPainting: "魔法绘画中...",
    aiCrafting: "AI 正在为您创作艺术杰作",
    stamp: "邮票",
    writeMessage: "在这里写下你的个人留言...",
    postcardMark: "明信片",
    postcardHint: "写下心意，传递温暖",
    blessingLabel: "祝福语",
    toLabel: "To · 收件人",
    fromLabel: "From · 寄信人",
    toPlaceholder: "对方姓名或称呼",
    fromPlaceholder: "你的姓名",
    showFront: "查看正面",
    backToStudio: "返回工作室",
    download: "下载",
    sendByEmail: "通过邮件发送",
    sending: "发送中...",
    sent: "已发送！",
    enterEmail: "输入收件人邮箱",
    send: "发送",
    rechargeTitle: "充值积分",
    rechargeDesc:
      "每次生成消耗 5 积分；默认赠送 15 积分，约可免费生成 3 张。需要更多时再选下方套餐。",
    popular: "热门",
    bestValue: "超值",
    customTheme: "自定义主题",
    themePlaceholder: "例如：生日、毕业",
    blessingPlaceholder: "例如：生日快乐！",
    sceneKeywords: "画面关键词（可选）",
    scenePlaceholder: "例如：温馨的咖啡馆，下雨天，气球",
    aspectRatio: "比例",
    paymentMethod: "支付方式",
    link: "Link",
    alipay: "支付宝",
    clickToFlip: "点击翻面 — 填写收件人、祝福语与寄信人",
    textSize: "文字大小",
    unlockCredits: "解锁积分",
    enterPassword: "输入密码",
    magicUnlocked: "魔法积分已解锁！",
    soraEggAlreadyUsed: "本浏览器已领取过 Sora 彩蛋积分，无法再次使用。",
    downloadStitched: "下载拼接图 (PNG)",
    downloadHidden: "下载隐藏图 (幻影坦克)",
    downloadMode: "下载模式",
    easterEggHint: "连点两下「Sora」或长按，可解锁小彩蛋",
    includeOccasionTitle: "在明信片上显示节日/主题标题",
    includeBlessingLine: "在明信片上显示祝福语",
    cardTextHint: "默认不在画面上添加任何文字；需要时再勾选下方选项。",
  }
};

const CREDITS_STORAGE_KEY = 'postcard-studio-credits';
/** Sora 彩蛋充值每浏览器仅可成功领取一次 */
const SORA_EGG_USED_KEY = 'postcard-studio-sora-egg-used';

function readSoraEggUsed(): boolean {
  try {
    return localStorage.getItem(SORA_EGG_USED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 5 credits per generation → 15 allows 3 free postcards for new visitors */
const DEFAULT_CREDITS = 15;

function readStoredCredits(): number {
  try {
    const raw = localStorage.getItem(CREDITS_STORAGE_KEY);
    if (raw == null) return DEFAULT_CREDITS;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_CREDITS;
    return Math.min(n, 1_000_000);
  } catch {
    return DEFAULT_CREDITS;
  }
}

function anchorDownloadPng(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Prefer system share (Save to Photos / 存储到相册) on phones; fallback to download link. */
function shareOrDownloadPngFromCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  shareHint: { title: string; text: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'));
          return;
        }

        const touchPrimary =
          typeof window !== 'undefined' &&
          (window.matchMedia('(hover: none)').matches ||
            window.matchMedia('(pointer: coarse)').matches);

        if (touchPrimary && typeof navigator.share === 'function') {
          try {
            const file = new File([blob], filename, { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: shareHint.title,
                text: shareHint.text,
              });
              resolve();
              return;
            }
          } catch (e: unknown) {
            const name = e instanceof Error ? e.name : '';
            if (name === 'AbortError') {
              resolve();
              return;
            }
            // fall through to anchor download
          }
        }

        try {
          anchorDownloadPng(blob, filename);
          resolve();
        } catch (err) {
          reject(err);
        }
      },
      'image/png',
      1.0
    );
  });
}

// --- Components ---

export default function App() {
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [selectedHoliday, setSelectedHoliday] = useState<Holiday>(HOLIDAYS[5]); // Default to Easter
  const [selectedStyle, setSelectedStyle] = useState<Style>(STYLES[0]); // Default to Watercolor
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [message, setMessage] = useState("");
  const [senderName, setSenderName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [customTheme, setCustomTheme] = useState("");
  const [customBlessing, setCustomBlessing] = useState("");
  const [customKeywords, setCustomKeywords] = useState("");
  /** Default: no lettering on the generated image; user opts in */
  const [includeTitleOnCard, setIncludeTitleOnCard] = useState(false);
  const [includeBlessingOnCard, setIncludeBlessingOnCard] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isSent, setIsSent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [credits, setCredits] = useState(readStoredCredits);
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'link' | 'alipay'>('link');
  /** Fixed on-image title position for the AI prompt (no drag UI). */
  const textPositionPct = { x: 50, y: 66.6 };
  const [textSize, setTextSize] = useState(24);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [password, setPassword] = useState("");
  const [soraEggUsed, setSoraEggUsed] = useState(readSoraEggUsed);
  const [isMagicActive, setIsMagicActive] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [postcardRevealKey, setPostcardRevealKey] = useState(0);
  const [parallaxTilt, setParallaxTilt] = useState({ rx: 0, ry: 0, smooth: true });
  const postcardTiltShellRef = useRef<HTMLDivElement>(null);
  /** 中文祝福语：模型不画字，前端行书叠在成图之上 */
  const [frontTextOverlay, setFrontTextOverlay] = useState<{ title: string; blessing: string } | null>(
    null
  );

  const t = TRANSLATIONS[language];

  const previewDefaultBlessing =
    language === 'zh' ? selectedHoliday.zhShortBlessing : selectedHoliday.shortBlessing;
  const previewBlessingText = includeBlessingOnCard
    ? customBlessing.trim() || previewDefaultBlessing
    : '';
  const previewTitleText = includeTitleOnCard
    ? selectedHoliday.id === 'custom'
      ? customTheme.trim() || t.customTheme
      : language === 'zh'
        ? selectedHoliday.zhName
        : selectedHoliday.name
    : '';
  const previewChineseBlessing = hasChineseChars(previewBlessingText);
  const previewChineseTitle = hasChineseChars(previewTitleText);
  
  // Cropping State
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);
  /** Natural w/h of current photo — outer crop/preview frame; Cropper `aspect` controls the inner crop box only */
  const [displayImageAspect, setDisplayImageAspect] = useState(4 / 3);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CREDITS_STORAGE_KEY, String(credits));
    } catch {
      /* quota / private mode */
    }
  }, [credits]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const fn = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    if (reduceMotion || !generatedImage) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const max = 10;
      const ry = Math.max(-max, Math.min(max, (e.gamma / 50) * max));
      const rx = Math.max(-max * 0.72, Math.min(max * 0.72, ((e.beta - 38) / 42) * max * 0.72));
      setParallaxTilt({ rx: -rx, ry, smooth: false });
    };

    window.addEventListener('deviceorientation', onOrient, true);
    return () => window.removeEventListener('deviceorientation', onOrient, true);
  }, [reduceMotion, generatedImage]);

  // Check for API key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      } else {
        // Fallback for environments without the selection tool
        setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Assume success per guidelines
    }
  };

  // Update body background class based on holiday
  useEffect(() => {
    document.body.className = `${selectedHoliday.bgColor} transition-colors duration-1000`;
  }, [selectedHoliday]);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close, { passive: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [downloadMenuOpen]);

  const aspectImageSrc = generatedImage || uploadedImage;
  useEffect(() => {
    if (!aspectImageSrc) {
      setDisplayImageAspect(4 / 3);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const h = Math.max(img.naturalHeight, 1);
      const r = img.naturalWidth / h;
      setDisplayImageAspect(Number.isFinite(r) && r > 0 ? r : 4 / 3);
    };
    img.onerror = () => setDisplayImageAspect(4 / 3);
    img.src = aspectImageSrc;
  }, [aspectImageSrc]);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setUploadedImage(result);
        setIsCropping(true);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const getCroppedImg = async (imageSrc: string, pixelCrop: Area): Promise<string | null> => {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    let targetWidth = pixelCrop.width;
    let targetHeight = pixelCrop.height;
    if (targetWidth > MAX_PREVIEW_CROP_DIM || targetHeight > MAX_PREVIEW_CROP_DIM) {
      const scale = MAX_PREVIEW_CROP_DIM / Math.max(targetWidth, targetHeight);
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      targetWidth,
      targetHeight
    );

    return canvas.toDataURL('image/jpeg', 0.92);
  };

  const handleConfirmCrop = async () => {
    if (uploadedImage && croppedAreaPixels) {
      try {
        const cropped = await getCroppedImg(uploadedImage, croppedAreaPixels);
        if (cropped) {
          setUploadedImage(cropped);
          setIsCropping(false);
        }
      } catch (e) {
        console.error(e);
        setError("Failed to crop image. Please try again.");
      }
    }
  };

  const handleGenerate = async () => {
    if (!uploadedImage) return;

    if (credits < 5) {
      setShowRechargeModal(true);
      return;
    }

    setIsGenerating(true);
    setError(null);

    // Set a safety timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      if (isGenerating) {
        setIsGenerating(false);
        setError("Request timed out. Please try a smaller image or check your connection.");
      }
    }, 60000); // 60 seconds timeout

    try {
      const useProxy = import.meta.env.VITE_USE_GEMINI_PROXY === 'true';
      const workerBase = (import.meta.env.VITE_GEMINI_WORKER_BASE || '').replace(/\/$/, '');
      const backendBase = (import.meta.env.VITE_GEMINI_BACKEND_URL || '').replace(/\/$/, '');

      const apiImageDataUrl = await compressImageDataUrlForApi(uploadedImage);
      const parsed = parseDataUrlImage(apiImageDataUrl);
      if (!parsed?.base64) {
        setError(
          language === 'zh' ? '图片数据无效，请重新上传。' : 'Invalid image data. Please upload again.'
        );
        return;
      }

      const defaultBlessing = language === 'zh' ? selectedHoliday.zhShortBlessing : selectedHoliday.shortBlessing;
      const blessingToUse = includeBlessingOnCard
        ? customBlessing.trim() || defaultBlessing
        : '';
      const sceneElements = selectedHoliday.id === 'custom' ? (customKeywords || selectedHoliday.elements) : selectedHoliday.elements;

      const holidayDisplayName =
        selectedHoliday.id === 'custom'
          ? customTheme.trim()
          : language === 'zh'
            ? selectedHoliday.zhName
            : selectedHoliday.name;

      if (includeTitleOnCard && selectedHoliday.id === 'custom' && !customTheme.trim()) {
        setError(
          language === 'zh'
            ? '已勾选显示主题标题，请填写自定义主题。'
            : 'You enabled the occasion title — please enter a custom theme.'
        );
        return;
      }

      const holidayName = selectedHoliday.id === 'custom' ? customTheme : selectedHoliday.name;

      const chineseBlessingOverlay = includeBlessingOnCard && hasChineseChars(blessingToUse);
      const postcardImageSize = '512' as const;

      const getVerticalPos = (y: number) => (y < 33 ? 'top' : y < 66 ? 'middle' : 'bottom');
      const getHorizontalPos = (x: number) => (x < 33 ? 'left' : x < 66 ? 'center' : 'right');
      const positionDesc = `${getVerticalPos(textPositionPct.y)}-${getHorizontalPos(textPositionPct.x)}`;

      const holidayNameForPrompt =
        selectedHoliday.id === 'custom'
          ? hasChineseChars(customTheme.trim())
            ? 'a personalized festive celebration'
            : customTheme.trim() || 'a custom celebration'
          : selectedHoliday.name;

      const overlayTitleForUi =
        selectedHoliday.id === 'custom'
          ? customTheme.trim() || (language === 'zh' ? '自定义' : 'Custom')
          : language === 'zh'
            ? selectedHoliday.zhName
            : selectedHoliday.name;

      const bakeCjkHints =
        !chineseBlessingOverlay &&
        ((includeTitleOnCard && hasChineseChars(holidayDisplayName)) ||
          (includeBlessingOnCard && hasChineseChars(blessingToUse)));

      const chineseTypographyBlock = bakeCjkHints
        ? (() => {
            const bits: string[] = [];
            if (includeTitleOnCard && hasChineseChars(holidayDisplayName)) {
              bits.push(`title "${holidayDisplayName}"`);
            }
            if (includeBlessingOnCard && hasChineseChars(blessingToUse)) {
              bits.push(`blessing "${blessingToUse}"`);
            }
            return `
      CHINESE TEXT: Exact strings — ${bits.join('; ')}. 行楷/楷书, sharp strokes, minimal bleed into glyphs, strong contrast vs background (${selectedStyle.name}).`;
          })()
        : '';

      const reserveZoneBlock = chineseBlessingOverlay
        ? `No CJK/glyphs in pixels. Theme ${holidayNameForPrompt}; include ${sceneElements}. Calm low-detail band at ${positionDesc} for later overlay. ${selectedStyle.promptSuffix}, ${selectedStyle.name} look.`
        : '';

      const wantsAnyCardText = includeTitleOnCard || includeBlessingOnCard;

      const promptNoText = `Transform this photo into ${selectedStyle.promptSuffix} postcard art. Scene mood: ${sceneElements}. The image must contain absolutely no text, letters, numbers, captions, titles, watermarks, logos, or typography — artwork only.`;

      let prompt: string;
      if (!wantsAnyCardText) {
        prompt = promptNoText;
      } else if (chineseBlessingOverlay) {
        prompt = `Transform photo into ${selectedStyle.promptSuffix} postcard art for ${holidayNameForPrompt}. ${reserveZoneBlock}`;
      } else {
        const lines: string[] = [
          `Transform this photo into ${selectedStyle.promptSuffix} for ${holidayName}. Scene: ${sceneElements}.`,
        ];
        if (chineseTypographyBlock.trim()) {
          lines.push(`TEXT:${chineseTypographyBlock}`);
        }
        let n = 1;
        if (includeTitleOnCard) {
          lines.push(
            `${n}) Title "${holidayDisplayName}" — large, matches ${selectedStyle.name}; ${hasChineseChars(holidayDisplayName) ? '行楷可读.' : 'elegant Latin script.'}`
          );
          n += 1;
        }
        if (includeBlessingOnCard) {
          lines.push(`${n}) Blessing "${blessingToUse}" — legible, ~${textSize}pt scale.`);
          n += 1;
        }
        lines.push(
          `${n}) Position ${includeTitleOnCard && includeBlessingOnCard ? 'both lines' : 'the text'} at ${positionDesc}; crisp text vs softer background; nothing cropped.`
        );
        prompt = lines.join('\n      ');
      }

      let resultDataUrl: string;

      if (useProxy) {
        if (workerBase) {
          resultDataUrl = await runGeminiPostcardViaWorkerRest(workerBase, {
            imageBase64: parsed.base64,
            mimeType: parsed.mimeType,
            prompt,
            imageSize: postcardImageSize,
          });
        } else {
          const url = `${backendBase || ''}/api/generate-postcard`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              mimeType: parsed.mimeType,
              imageBase64: parsed.base64,
              imageSize: postcardImageSize,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as { dataUrl?: string; error?: string };
          if (!res.ok) {
            throw new Error(
              typeof data.error === 'string' && data.error
                ? data.error
                : res.statusText || 'Image proxy request failed.'
            );
          }
          if (typeof data.dataUrl !== 'string' || !data.dataUrl) {
            throw new Error('Invalid response from image proxy.');
          }
          resultDataUrl = data.dataUrl;
        }
      } else {
        const apiKey = (
          import.meta.env.VITE_GEMINI_API_KEY?.trim() ||
          (typeof process.env.GEMINI_API_KEY === 'string'
            ? process.env.GEMINI_API_KEY.trim()
            : '')
        ).trim();
        if (!apiKey) {
          setError(
            language === 'zh'
              ? '未检测到 API 密钥。请在项目根目录的 .env 中设置 GEMINI_API_KEY 或 VITE_GEMINI_API_KEY，保存后重启 npm run dev；或设置 VITE_USE_GEMINI_PROXY=true 使用后端代调。'
              : 'Missing API key. Add GEMINI_API_KEY or VITE_GEMINI_API_KEY to .env, or set VITE_USE_GEMINI_PROXY=true to use the backend proxy.'
          );
          return;
        }
        resultDataUrl = await runGeminiPostcardGeneration(apiKey, {
          imageBase64: parsed.base64,
          mimeType: parsed.mimeType,
          prompt,
          imageSize: postcardImageSize,
        });
      }

      setGeneratedImage(resultDataUrl);
      setPostcardRevealKey((k) => k + 1);
      if (chineseBlessingOverlay) {
        setFrontTextOverlay({
          title: includeTitleOnCard ? overlayTitleForUi : '',
          blessing: blessingToUse,
        });
      } else {
        setFrontTextOverlay(null);
      }
      setCredits((prev) => prev - 5);
    } catch (err: unknown) {
      console.error('Generation error:', err);

      const raw = formatGenaiError(err).toLowerCase();
      const builtWithProxy = import.meta.env.VITE_USE_GEMINI_PROXY === 'true';
      const looksVertexOrWorker =
        builtWithProxy ||
        raw.includes('aiplatform') ||
        raw.includes('vertex') ||
        raw.includes('oauth') ||
        raw.includes('service account');
      let userFriendlyError =
        language === 'zh' ? '生成失败，请稍后再试。' : 'Failed to generate postcard. Please try again.';

      if (raw.includes('429') || raw.includes('quota') || raw.includes('resource exhausted')) {
        userFriendlyError =
          language === 'zh'
            ? 'API 配额已满，请稍后再试。'
            : 'API quota exceeded. Please wait a minute before trying again.';
      } else if (
        raw.includes('401') ||
        raw.includes('api key') ||
        raw.includes('permission denied') ||
        raw.includes('unauthorized')
      ) {
        if (looksVertexOrWorker) {
          userFriendlyError =
            language === 'zh'
              ? '鉴权失败（Vertex / Worker）：请检查 Cloudflare Worker 的 GCP_SA_KEY_JSON、VERTEX_PROJECT_ID、VERTEX_LOCATION，GCP 中是否启用 Vertex AI API，以及服务账号是否有 Vertex AI User 等权限。若线上页面未走 Worker，请在香港服务器用 VITE_USE_GEMINI_PROXY=true 与 VITE_GEMINI_WORKER_BASE=你的 Worker 地址重新执行 npm run build。'
              : 'Auth failed (Vertex / Worker): verify Cloudflare Worker secrets (GCP_SA_KEY_JSON), VERTEX_PROJECT_ID, VERTEX_LOCATION, Vertex AI API enabled, and service-account roles. If the site was built without the proxy flags, rebuild with VITE_USE_GEMINI_PROXY=true and VITE_GEMINI_WORKER_BASE=<your worker URL>.';
        } else {
          userFriendlyError =
            language === 'zh'
              ? 'API 密钥无效或无权使用该模型，请检查 Google AI Studio 中的密钥与账单。'
              : 'Invalid API key or permission denied. Check your key and billing in Google AI Studio.';
          if (raw.includes('not found') || raw.includes('permission')) {
            setHasApiKey(false);
          }
        }
      } else if (raw.includes('not found') || raw.includes('404') || raw.includes('does not exist')) {
        userFriendlyError = looksVertexOrWorker
          ? language === 'zh'
            ? '模型或区域不可用：确认 Vertex 区域（如 asia-east1）支持所选图像模型，且项目已开通相应 API。'
            : 'Model or region unavailable: confirm your Vertex location supports the image model and APIs are enabled.'
          : language === 'zh'
            ? '当前账号不可用所选图像模型，请在 AI Studio 启用计费或更换可用的 Gemini 模型。'
            : 'Image model not available for this API key. Enable billing or use a project with access in AI Studio.';
      } else if (raw.includes('safety') || raw.includes('blocked') || raw.includes('blockreason')) {
        userFriendlyError =
          language === 'zh'
            ? '内容未通过安全策略，请换一张照片或修改文案后再试。'
            : 'Content was blocked by safety filters. Try another photo or shorter text.';
      } else if (raw.includes('no image') || raw.includes('finishreason')) {
        userFriendlyError =
          language === 'zh'
            ? '模型未返回图片，可能被安全策略拦截或暂时异常，请重试。'
            : 'The model did not return an image (safety or temporary error). Please try again.';
      }

      setError(userFriendlyError);
    } finally {
      clearTimeout(timeoutId);
      setIsGenerating(false);
    }
  };

  // If API key is required but not selected, show selection UI (skip when using backend proxy)
  if (import.meta.env.VITE_USE_GEMINI_PROXY !== 'true' && hasApiKey === false) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-8 ${selectedHoliday.bgColor}`}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-10 rounded-3xl shadow-2xl max-w-md w-full text-center"
        >
          <div className="w-20 h-20 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Sparkles size={40} />
          </div>
          <h2 className="text-2xl font-bold mb-4">API Key Required</h2>
          <p className="text-slate-500 mb-8">
            To use the high-quality image generation model, you need to select an API key from a paid Google Cloud project.
          </p>
          <button 
            onClick={handleSelectKey}
            className="w-full py-4 bg-slate-900 text-white rounded-full font-semibold shadow-lg hover:bg-slate-800 transition-all mb-4"
          >
            Select API Key
          </button>
          <a 
            href="https://ai.google.dev/gemini-api/docs/billing" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-sm text-slate-400 hover:text-slate-600 underline"
          >
            Learn about Gemini API billing
          </a>
        </motion.div>
      </div>
    );
  }

  const playSound = (type: 'magic' | 'paper') => {
    const sounds = {
      magic: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
      paper: '/sounds/paper.mp3',
    };
    const audio = new Audio(sounds[type]);
    audio.volume = 0.5;
    audio.play().catch(() => {});
  };

  const handleDownload = async (mode: 'stitched' | 'phantom') => {
    if (!generatedImage) return;

    playSound('paper');
    setDownloadMenuOpen(false);

    try {
      const frontImg = await createImage(generatedImage);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Create back side canvas with EXACT same dimensions as front
      const backCanvas = document.createElement('canvas');
      const bCtx = backCanvas.getContext('2d');
      if (!bCtx) return;
      
      backCanvas.width = frontImg.width;
      backCanvas.height = frontImg.height;

      await document.fonts.ready.catch(() => {});
      if (frontTextOverlay) {
        await ensureXingshuFontsLoaded();
      }

      const holidayLabel = language === 'zh' ? selectedHoliday.zhName : selectedHoliday.name;
      const backLabels: PostcardBackLabels = {
        postcardMark: t.postcardMark,
        postcardHint: t.postcardHint,
        blessingLabel: t.blessingLabel,
        toLabel: t.toLabel,
        fromLabel: t.fromLabel,
        stampLabel: t.stamp,
        toPlaceholder: t.toPlaceholder,
        fromPlaceholder: t.fromPlaceholder,
      };
      drawPostcardBack(
        bCtx,
        backCanvas.width,
        backCanvas.height,
        language,
        holidayLabel,
        message,
        senderName,
        recipientName,
        backLabels
      );

      if (mode === 'stitched') {
        // Composite canvas (Vertical)
        const borderSize = frontImg.width * 0.04;
        canvas.width = frontImg.width + borderSize * 2;
        canvas.height = (frontImg.height + borderSize * 2) * 2;
        
        // Draw white border for front
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, frontImg.height + borderSize * 2);
        ctx.drawImage(frontImg, borderSize, borderSize);
        if (frontTextOverlay) {
          drawPostcardFrontTextOverlay(
            ctx,
            borderSize,
            borderSize,
            frontImg.width,
            frontImg.height,
            frontTextOverlay.title,
            frontTextOverlay.blessing,
            textSize,
            textPositionPct
          );
        }
        
        // Draw back with same border
        ctx.fillStyle = 'white';
        ctx.fillRect(0, frontImg.height + borderSize * 2, canvas.width, frontImg.height + borderSize * 2);
        ctx.drawImage(backCanvas, borderSize, frontImg.height + borderSize * 2 + borderSize);

        await shareOrDownloadPngFromCanvas(
          canvas,
          `postcard-stitched-${selectedHoliday.id}.png`,
          language === 'zh'
            ? {
                title: '明信片 · 拼接图',
                text: '在分享面板中选「存储图像」或「存储到照片」可保存到相册',
              }
            : {
                title: 'Postcard (stitched)',
                text: 'Choose Save Image or Save to Photos in the share sheet to add to your gallery',
              }
        );
      } else {
        // Phantom Tank Mode (Color Front Optimized)
        canvas.width = frontImg.width;
        canvas.height = frontImg.height;
        
        ctx.drawImage(frontImg, 0, 0);
        if (frontTextOverlay) {
          drawPostcardFrontTextOverlay(
            ctx,
            0,
            0,
            frontImg.width,
            frontImg.height,
            frontTextOverlay.title,
            frontTextOverlay.blessing,
            textSize,
            textPositionPct
          );
        }
        const frontData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        bCtx.drawImage(backCanvas, 0, 0);
        const backData = bCtx.getImageData(0, 0, canvas.width, canvas.height);
        
        const outputData = ctx.createImageData(canvas.width, canvas.height);
        
        for (let i = 0; i < frontData.data.length; i += 4) {
          const fR = frontData.data[i];
          const fG = frontData.data[i+1];
          const fB = frontData.data[i+2];
          
          // Invert and darken the back image (hidden layer)
          const bR = (255 - backData.data[i]) * 0.6;
          const bG = (255 - backData.data[i+1]) * 0.6;
          const bB = (255 - backData.data[i+2]) * 0.6;
          
          // Luminance for alpha calculation
          const fL = (fR * 0.299 + fG * 0.587 + fB * 0.114);
          const bL = (bR * 0.299 + bG * 0.587 + bB * 0.114);
          
          // Standard Mirage formula: A = 1 - (F - B)
          // To preserve front color on white: A must be >= 1 - F/255
          const aMin = Math.max(1 - fR/255, 1 - fG/255, 1 - fB/255);
          const aTarget = 1 - (fL - bL) / 255;
          const A = Math.max(aMin, aTarget, 0.0001);
          
          // Solve for C: C * A + 255 * (1 - A) = F
          // C = (F - 255 * (1 - A)) / A
          // Added clamp to prevent noise
          outputData.data[i] = Math.min(255, Math.max(0, Math.round((fR - 255 * (1 - A)) / A)));
          outputData.data[i+1] = Math.min(255, Math.max(0, Math.round((fG - 255 * (1 - A)) / A)));
          outputData.data[i+2] = Math.min(255, Math.max(0, Math.round((fB - 255 * (1 - A)) / A)));
          outputData.data[i+3] = Math.round(A * 255);
        }
        
        ctx.putImageData(outputData, 0, 0);

        await shareOrDownloadPngFromCanvas(
          canvas,
          `postcard-hidden-${selectedHoliday.id}.png`,
          language === 'zh'
            ? {
                title: '明信片 · 隐藏图',
                text: '在分享面板中选「存储图像」或「存储到照片」可保存到相册',
              }
            : {
                title: 'Postcard (hidden)',
                text: 'Choose Save Image or Save to Photos in the share sheet to add to your gallery',
              }
        );
      }
    } catch (err) {
      console.error("Download error:", err);
    }
  };

  const handleSendClick = () => {
    setShowEmailInput(true);
  };

  const handleFinalSend = async () => {
    if (!recipientEmail) return;
    setIsSending(true);
    playSound('paper');
    
    // Simulate API call to Resend
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsSending(false);
    setIsSent(true);
    setShowEmailInput(false);
  };

  const handleRecharge = (amount: number, bonus: number) => {
    setCredits(prev => prev + bonus);
    setShowRechargeModal(false);
  };

  const reset = () => {
    setUploadedImage(null);
    setGeneratedImage(null);
    setIsFlipped(false);
    setIsCropping(false);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setMessage("");
    setSenderName("");
    setRecipientName("");
    setCustomTheme("");
    setCustomBlessing("");
    setCustomKeywords("");
    setSelectedStyle(STYLES[0]);
    setRecipientEmail("");
    setIsSent(false);
    setShowEmailInput(false);
    setError(null);
    setParallaxTilt({ rx: 0, ry: 0, smooth: true });
    setFrontTextOverlay(null);
    setIncludeTitleOnCard(false);
    setIncludeBlessingOnCard(false);
  };

  const handleEasterEggClick = () => {
    setShowEasterEgg(false);
    setShowPasswordInput(true);
  };

  const handleUnlockMagic = () => {
    if (readSoraEggUsed()) {
      setSoraEggUsed(true);
      setShowPasswordInput(false);
      setPassword("");
      return;
    }
    if (password.toLowerCase() !== 'alex') {
      setPassword("");
      return;
    }
    try {
      localStorage.setItem(SORA_EGG_USED_KEY, '1');
    } catch {
      /* private mode */
    }
    setSoraEggUsed(true);
    setIsMagicActive(true);
    playSound('magic');
    setCredits((prev) => prev + 99);
    setShowPasswordInput(false);
    setPassword("");
    setTimeout(() => setIsMagicActive(false), 3000);
  };

  const handlePostcardPointerMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (reduceMotion || !postcardTiltShellRef.current) return;
      const rect = postcardTiltShellRef.current.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const py = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      const max = 9.5;
      setParallaxTilt({ rx: -py * max * 0.78, ry: px * max, smooth: false });
    },
    [reduceMotion]
  );

  const handlePostcardPointerLeave = useCallback(() => {
    setParallaxTilt({ rx: 0, ry: 0, smooth: true });
  }, []);

  const handlePostcardTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      if (reduceMotion || !postcardTiltShellRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      const rect = postcardTiltShellRef.current.getBoundingClientRect();
      const px = ((t.clientX - rect.left) / rect.width - 0.5) * 2;
      const py = ((t.clientY - rect.top) / rect.height - 0.5) * 2;
      const max = 11;
      setParallaxTilt({ rx: -py * max * 0.82, ry: px * max, smooth: false });
    },
    [reduceMotion]
  );

  const handlePostcardTouchEnd = useCallback(() => {
    setParallaxTilt({ rx: 0, ry: 0, smooth: true });
  }, []);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const lastSoraTapRef = useRef(0);

  const handleSoraTouchStart = (e: TouchEvent<HTMLSpanElement> | MouseEvent<HTMLSpanElement>) => {
    if (!generatedImage) return;
    if ('touches' in e && e.touches[0]) {
      longPressOriginRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if ('clientX' in e) {
      longPressOriginRef.current = { x: e.clientX, y: e.clientY };
    }
    longPressTimer.current = setTimeout(() => {
      setShowEasterEgg(true);
      longPressTimer.current = null;
    }, 700);
  };

  const handleSoraTouchMove = (e: TouchEvent<HTMLSpanElement>) => {
    if (!longPressOriginRef.current || !longPressTimer.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - longPressOriginRef.current.x);
    const dy = Math.abs(t.clientY - longPressOriginRef.current.y);
    if (dx > 14 || dy > 14) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleSoraTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOriginRef.current = null;
  };

  /** Mobile: double-tap is reliable; long-press is flaky in many in-app browsers */
  const handleSoraClickMobileEgg = () => {
    if (!generatedImage) return;
    if (!window.matchMedia('(hover: none)').matches) return;
    const now = Date.now();
    const prev = lastSoraTapRef.current;
    if (prev > 0 && now - prev < 450) {
      setShowEasterEgg(true);
      lastSoraTapRef.current = 0;
    } else {
      lastSoraTapRef.current = now;
    }
  };

  return (
    <div
      className={`min-h-screen flex flex-col items-center px-3 py-3 sm:px-4 sm:py-4 md:p-8 max-w-5xl mx-auto ${isMagicActive ? 'animate-pulse bg-gradient-to-r from-purple-100 via-pink-100 to-amber-100' : ''}`}
    >
      {/* Magic Celebration */}
      <AnimatePresence>
        {isMagicActive && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center"
          >
            <div className="text-6xl">✨🪄✨</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="w-full flex flex-col gap-4 md:flex-row md:justify-between md:items-center mb-8 md:mb-12">
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
          <div className="flex items-center gap-2.5 sm:gap-3 w-full sm:w-auto justify-center sm:justify-start">
            <div className={`p-2 rounded-xl bg-white shadow-sm border border-slate-100 shrink-0 ${selectedHoliday.accentColor}`}>
              <Sparkles size={26} />
            </div>
            <div className="flex flex-col items-center sm:items-start gap-0.5 min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl md:text-2xl font-semibold tracking-tight select-none text-center sm:text-left leading-snug">
              <span
                role={generatedImage ? 'button' : undefined}
                tabIndex={generatedImage ? 0 : undefined}
                onKeyDown={
                  generatedImage
                    ? (ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setShowEasterEgg(true);
                        }
                      }
                    : undefined
                }
                onMouseDown={generatedImage ? handleSoraTouchStart : undefined}
                onMouseUp={generatedImage ? handleSoraTouchEnd : undefined}
                onMouseLeave={generatedImage ? handleSoraTouchEnd : undefined}
                onTouchStart={generatedImage ? handleSoraTouchStart : undefined}
                onTouchMove={generatedImage ? handleSoraTouchMove : undefined}
                onTouchEnd={generatedImage ? handleSoraTouchEnd : undefined}
                onClick={generatedImage ? handleSoraClickMobileEgg : undefined}
                className={`${generatedImage ? 'cursor-pointer touch-manipulation hover:text-amber-500 transition-colors' : ''}`}
              >
                Sora
              </span>
              {language === 'zh' ? '的明信片工坊' : "'s Postcard Studio"}
            </h1>
            {generatedImage && (
              <p className="md:hidden text-center text-[11px] leading-snug text-slate-400 max-w-[min(100%,280px)] px-1">
                {t.easterEggHint}
              </p>
            )}
            </div>
            
            {showEasterEgg && (
              <motion.button
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                onClick={handleEasterEggClick}
                className="text-3xl hover:scale-125 transition-transform"
              >
                🥚
              </motion.button>
            )}
          </div>
          
          <div className="flex items-center gap-2 bg-white px-3 py-2 sm:px-4 rounded-full border border-slate-100 shadow-sm shrink-0">
            <div className="flex items-center gap-1.5 text-amber-600 font-bold text-sm sm:text-base">
              <Sparkles size={16} className="shrink-0" />
              <span className="whitespace-nowrap">{credits} {t.credits}</span>
            </div>
            <button 
              onClick={() => setShowRechargeModal(true)}
              className="ml-1 text-[11px] sm:text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-wider shrink-0"
            >
              {t.topUp}
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto md:shrink-0">
          <button 
            onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
            className="w-full sm:w-auto px-4 py-2.5 bg-white border border-slate-200 rounded-full text-sm font-medium shadow-sm hover:bg-slate-50 transition-all"
          >
            {language === 'en' ? '中文' : 'English'}
          </button>

          <div className="relative group w-full sm:w-auto min-w-0">
              <select 
                value={selectedHoliday.id}
                onChange={(e) => {
                  const holiday = HOLIDAYS.find(h => h.id === e.target.value);
                  if (holiday) setSelectedHoliday(holiday);
                }}
                className="appearance-none w-full sm:min-w-[12rem] bg-white border border-slate-200 rounded-full px-4 sm:px-6 py-2.5 pr-10 sm:pr-12 shadow-sm hover:border-slate-300 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-200 font-medium text-sm sm:text-base"
              >
                {HOLIDAYS.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.emoji} {language === 'zh' ? h.zhName : h.name}
                  </option>
                ))}
              </select>
            <ChevronDown className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" size={18} />
          </div>
        </div>
      </header>

      <main className="w-full flex-1 flex flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {!uploadedImage && !isGenerating && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl"
            >
              <div 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setUploadedImage(reader.result as string);
                      setIsCropping(true);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                className="group relative aspect-[4/3] w-full bg-white rounded-3xl border-2 border-dashed border-slate-200 hover:border-slate-400 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 overflow-hidden shadow-sm"
              >
                <div className="p-6 rounded-full bg-slate-50 group-hover:scale-110 transition-transform duration-500">
                  <Upload className="text-slate-400 group-hover:text-slate-600" size={40} />
                </div>
                <div className="text-center px-2">
                  <p className="text-base sm:text-lg font-medium text-slate-700">{t.uploadPhoto}</p>
                  <p className="text-sm sm:text-base text-slate-400 mt-1.5 leading-snug">{t.dragDrop}</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  className="hidden" 
                  accept="image/*" 
                />
              </div>
            </motion.div>
          )}

          {uploadedImage && isCropping && !isGenerating && (
            <motion.div 
              key="cropping"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-2xl flex flex-col items-center gap-4 sm:gap-6"
            >
              <div
                className="relative w-full rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border-4 sm:border-8 border-white bg-slate-900"
                style={{ aspectRatio: displayImageAspect }}
              >
                <Cropper
                  image={uploadedImage}
                  crop={crop}
                  zoom={zoom}
                  aspect={aspectRatio}
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                />
              </div>
              
              <div className="w-full flex flex-col gap-4 sm:gap-6 bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm">
                <div className="flex flex-col gap-2 sm:gap-3">
                  <span className="text-sm sm:text-base font-medium text-slate-500 ml-0.5 sm:ml-1">{t.aspectRatio || 'Aspect Ratio'}</span>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {[
                      { label: 'Free', value: undefined },
                      { label: '1:1', value: 1 },
                      { label: '4:3', value: 4/3 },
                      { label: '3:4', value: 3/4 },
                      { label: '16:9', value: 16/9 },
                      { label: '9:16', value: 9/16 },
                    ].map((ratio) => (
                      <button
                        key={ratio.label}
                        onClick={() => setAspectRatio(ratio.value)}
                        className={`px-3 py-2 sm:px-4 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold transition-all border ${
                          aspectRatio === ratio.value
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-300'
                        }`}
                      >
                        {ratio.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:gap-4">
                  <span className="text-sm sm:text-base font-medium text-slate-500 shrink-0">{t.zoom}</span>
                  <input
                    type="range"
                    value={zoom}
                    min={1}
                    max={3}
                    step={0.1}
                    aria-labelledby="Zoom"
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-900"
                  />
                </div>
                
                <div className="flex gap-3">
                  <button 
                    onClick={() => setUploadedImage(null)}
                    className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={18} />
                    {t.cancel}
                  </button>
                  <button 
                    onClick={handleConfirmCrop}
                    className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-semibold shadow-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                  >
                    <Check size={18} />
                    {t.confirmCrop}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {uploadedImage && !isCropping && !generatedImage && !isGenerating && (
            <motion.div 
              key="preview"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-2xl flex flex-col items-center gap-5 sm:gap-8"
            >
              <div
                style={{ aspectRatio: displayImageAspect }}
                className="relative w-full rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border-4 sm:border-8 border-white"
              >
                <img src={uploadedImage} alt="Preview" className="w-full h-full object-cover select-none" />
                
                {(previewTitleText || previewBlessingText) && (
                  <motion.div
                    style={{
                      left: `${textPositionPct.x}%`,
                      top: `${textPositionPct.y}%`,
                      x: '-50%',
                      y: '-50%',
                    }}
                    className="absolute z-10 p-2.5 sm:p-4 max-w-[min(92%,18rem)] sm:max-w-none bg-white/20 backdrop-blur-md border border-white/30 rounded-lg sm:rounded-xl flex flex-col items-center text-center shadow-lg pointer-events-none"
                  >
                    {previewTitleText ? (
                      <p
                        style={{ fontSize: `${textSize}px` }}
                        className={`text-white drop-shadow-md leading-tight sm:leading-none ${
                          previewChineseTitle ? 'font-chinese-xingshu' : 'font-serif italic'
                        }`}
                      >
                        {previewTitleText}
                      </p>
                    ) : null}
                    {previewBlessingText ? (
                      <p
                        style={{ fontSize: `${textSize * 0.5}px` }}
                        className={`drop-shadow-md ${previewTitleText ? 'mt-1' : ''} max-w-[min(100%,10rem)] sm:max-w-[140px] line-clamp-2 sm:line-clamp-1 leading-snug ${
                          previewChineseBlessing ? 'font-chinese-xingshu text-white/95' : 'text-white/80'
                        }`}
                      >
                        {previewBlessingText}
                      </p>
                    ) : null}
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full animate-pulse" />
                  </motion.div>
                )}

                <button 
                  onClick={() => setUploadedImage(null)}
                  className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-colors z-20"
                >
                  <RefreshCw size={20} />
                </button>
              </div>

              <div className="w-full flex flex-col gap-5 sm:gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-sm sm:text-base font-medium text-slate-500 ml-1 sm:ml-2">{t.selectStyle}</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                    {STYLES.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setSelectedStyle(style)}
                        className={`py-2.5 sm:py-3 px-2 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-medium transition-all border-2 leading-snug ${
                          selectedStyle.id === style.id
                            ? `bg-white border-slate-900 shadow-md ${selectedHoliday.accentColor}`
                            : 'bg-white/50 border-transparent text-slate-400 hover:bg-white hover:border-slate-200'
                        }`}
                      >
                        {language === 'zh' ? style.zhName : style.name}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-slate-500 px-1 sm:px-2 leading-relaxed">{t.cardTextHint}</p>
                <div className="flex flex-col gap-3 sm:gap-3.5 bg-white/60 rounded-2xl border border-slate-100 p-3 sm:p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeTitleOnCard}
                      onChange={(e) => setIncludeTitleOnCard(e.target.checked)}
                      className="mt-1 rounded border-slate-300 text-slate-900 focus:ring-slate-200"
                    />
                    <span className="text-sm sm:text-base text-slate-700 leading-snug">{t.includeOccasionTitle}</span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeBlessingOnCard}
                      onChange={(e) => setIncludeBlessingOnCard(e.target.checked)}
                      className="mt-1 rounded border-slate-300 text-slate-900 focus:ring-slate-200"
                    />
                    <span className="text-sm sm:text-base text-slate-700 leading-snug">{t.includeBlessingLine}</span>
                  </label>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center px-1 sm:px-2">
                    <label className="text-sm sm:text-base font-medium text-slate-500">{t.textSize}</label>
                    <span className="text-xs sm:text-sm font-bold text-slate-400 tabular-nums">{textSize}px</span>
                  </div>
                  <input
                    type="range"
                    value={textSize}
                    min={12}
                    max={48}
                    step={1}
                    onChange={(e) => setTextSize(Number(e.target.value))}
                    className="w-full h-1.5 bg-white rounded-lg appearance-none cursor-pointer accent-slate-900 border border-slate-100"
                  />
                </div>

                {selectedHoliday.id === 'custom' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-sm sm:text-base font-medium text-slate-500 ml-1 sm:ml-2">
                        {t.customTheme}
                        {includeTitleOnCard ? <span className="text-red-500 font-normal"> *</span> : null}
                      </label>
                      <input 
                        type="text"
                        placeholder={t.themePlaceholder}
                        value={customTheme}
                        onChange={(e) => setCustomTheme(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3.5 sm:px-6 sm:py-4 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-sm sm:text-base font-medium text-slate-500 ml-1 sm:ml-2">{t.sceneKeywords}</label>
                      <input 
                        type="text"
                        placeholder={t.scenePlaceholder}
                        value={customKeywords}
                        onChange={(e) => setCustomKeywords(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3.5 sm:px-6 sm:py-4 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                      />
                    </div>
                  </>
                )}

                {includeBlessingOnCard && (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm sm:text-base font-medium text-slate-500 ml-1 sm:ml-2">{t.customBlessing}</label>
                    <input 
                      type="text"
                      placeholder={language === 'zh' ? selectedHoliday.zhPlaceholder : selectedHoliday.placeholder}
                      value={customBlessing}
                      onChange={(e) => setCustomBlessing(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3.5 sm:px-6 sm:py-4 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                    />
                  </div>
                )}

                <div className="flex flex-col items-center gap-3 sm:gap-4 w-full">
                  <button 
                    onClick={handleGenerate}
                    className="w-full max-w-md sm:max-w-xs py-3.5 sm:py-4 px-4 sm:px-8 rounded-full bg-slate-900 text-white text-sm sm:text-base font-semibold shadow-xl hover:bg-slate-800 hover:-translate-y-1 transition-all flex items-center justify-center gap-2 sm:gap-3 text-center leading-snug min-h-[3rem]"
                  >
                    <Sparkles size={20} className="shrink-0" />
                    {t.createCard.replace('{name}', language === 'zh' ? selectedHoliday.zhName : selectedHoliday.name)}
                  </button>
                  {error && <p className="text-red-600 text-sm sm:text-base font-medium text-center px-2">{error}</p>}
                </div>
              </div>
            </motion.div>
          )}

          {isGenerating && (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-6 sm:gap-8 px-2"
            >
              <div className="relative w-28 h-28 sm:w-32 sm:h-32">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border-4 border-dashed border-slate-300 rounded-full"
                />
                <motion.div 
                  animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 1, 0.5]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className={`absolute inset-4 rounded-full flex items-center justify-center ${selectedHoliday.accentColor}`}
                >
                  <ImageIcon size={40} />
                </motion.div>
              </div>
              <div className="text-center max-w-md">
                <h2 className="text-xl sm:text-2xl font-serif italic text-slate-800 leading-snug">{t.magicalPainting}</h2>
                <p className="text-slate-400 mt-2 text-sm sm:text-base leading-relaxed">{t.aiCrafting}</p>
              </div>
            </motion.div>
          )}

              {generatedImage && !isGenerating && (
                <motion.div 
                  key="result"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-3xl flex flex-col items-center gap-6 sm:gap-10 md:gap-12 mt-4 sm:mt-6"
                >
                  {/* 3D Card + pointer parallax */}
                  <div
                    ref={postcardTiltShellRef}
                    className="perspective-1000 w-full max-w-2xl relative group"
                    style={{ aspectRatio: displayImageAspect }}
                    onMouseMove={handlePostcardPointerMove}
                    onMouseLeave={handlePostcardPointerLeave}
                    onTouchMove={handlePostcardTouchMove}
                    onTouchEnd={handlePostcardTouchEnd}
                  >
                <div
                  className="h-full w-full"
                  style={{
                    transform: `rotateX(${parallaxTilt.rx}deg) rotateY(${parallaxTilt.ry}deg)`,
                    transformStyle: 'preserve-3d',
                    transition: parallaxTilt.smooth
                      ? 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
                      : 'transform 0.06s ease-out',
                  }}
                >
                {/* Flip Hint */}
                <AnimatePresence>
                  {!isFlipped && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute -top-10 sm:-top-12 left-1/2 -translate-x-1/2 z-10 bg-slate-900/80 backdrop-blur-md text-white px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 pointer-events-none shadow-lg max-w-[calc(100vw-1.5rem)] justify-center text-center leading-snug"
                    >
                      <motion.div
                        animate={{ x: [0, 5, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      >
                        <ArrowRight size={16} />
                      </motion.div>
                      {t.clickToFlip}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.div 
                  animate={{ rotateY: isFlipped ? 180 : 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className="relative w-full h-full preserve-3d cursor-pointer"
                  onClick={() => setIsFlipped(!isFlipped)}
                >
                  {/* Front — 翻面后仍需禁用点击：translateZ 正面层否则会盖住背面并抢走输入焦点 */}
                  <div
                    className={`absolute inset-0 backface-hidden rounded-none shadow-2xl overflow-hidden bg-white p-2 sm:p-3 md:p-6 border border-slate-100 ${
                      isFlipped ? 'pointer-events-none' : ''
                    }`}
                  >
                    <div className="postcard-front-stack relative h-full w-full rounded-none overflow-hidden border-[4px] sm:border-[6px] md:border-[8px] border-white shadow-inner">
                      <motion.div
                        key={`reveal-${postcardRevealKey}`}
                        className="relative z-0 h-full w-full"
                        initial={
                          reduceMotion
                            ? { opacity: 0 }
                            : {
                                clipPath: 'circle(0% at 50% 50%)',
                                opacity: 0.82,
                              }
                        }
                        animate={
                          reduceMotion
                            ? { opacity: 1 }
                            : {
                                clipPath: 'circle(150% at 50% 50%)',
                                opacity: 1,
                              }
                        }
                        transition={{ duration: reduceMotion ? 0.3 : 1.35, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <img
                          src={generatedImage}
                          alt="Watercolor Postcard"
                          className={`h-full w-full object-cover ${!reduceMotion ? 'postcard-breathe-img' : ''}`}
                        />
                      </motion.div>
                      {frontTextOverlay && (
                        <div
                          className="pointer-events-none absolute inset-0 z-[25] flex items-center justify-center [transform:translateZ(2px)]"
                          aria-hidden
                        >
                          <div
                            style={{
                              left: `${textPositionPct.x}%`,
                              top: `${textPositionPct.y}%`,
                              transform: 'translate3d(-50%, -50%, 0)',
                            }}
                            className="absolute max-w-[min(92%,20rem)] text-center px-2"
                          >
                            <p
                              style={{ fontSize: `clamp(14px, ${textSize * 1.05}px, 11vw)` }}
                              className="font-chinese-xingshu text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.85),0_0_18px_rgba(0,0,0,0.2)] leading-tight"
                            >
                              {frontTextOverlay.title}
                            </p>
                            <p
                              style={{ fontSize: `clamp(11px, ${textSize * 0.55}px, 5vw)` }}
                              className="font-chinese-xingshu text-white/95 mt-1.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)] leading-snug"
                            >
                              {frontTextOverlay.blessing}
                            </p>
                          </div>
                        </div>
                      )}
                      <PostcardAmbientParticles holidayId={selectedHoliday.id} reducedMotion={reduceMotion} />
                    </div>
                  </div>

                  {/* Back — layout mirrors drawPostcardBack() for downloads */}
                  <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-none shadow-2xl bg-[#fffdfa] border border-slate-100 flex flex-col overflow-hidden">
                    <div
                      className="pointer-events-none absolute inset-0 opacity-[0.04] bg-[repeating-linear-gradient(transparent,transparent_1.75rem,rgba(100,116,139,0.35)_1.75rem,rgba(100,116,139,0.35)_calc(1.75rem+1px))]"
                      aria-hidden
                    />
                    <div
                      className="relative flex flex-col flex-1 min-h-0 p-4 sm:p-5 md:p-7"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex justify-between items-end gap-2 sm:gap-3 border-b border-slate-200/90 pb-2.5 sm:pb-3 mb-4 sm:mb-6 shrink-0">
                        <div className="min-w-0">
                          <p className="text-[11px] sm:text-[10px] font-semibold tracking-[0.2em] sm:tracking-[0.26em] text-slate-400 uppercase">
                            {t.postcardMark}
                          </p>
                          <p className="text-xs sm:text-[11px] text-slate-400 mt-1 leading-snug max-w-[13rem] sm:max-w-[11rem] md:max-w-none">
                            {t.postcardHint}
                          </p>
                        </div>
                        <p className="font-serif italic text-sm sm:text-base md:text-lg text-slate-700 text-right leading-tight shrink-0">
                          {language === 'zh' ? selectedHoliday.zhName : selectedHoliday.name}{' '}
                          <span className="text-slate-400 not-italic text-xs sm:text-sm font-sans">2026</span>
                        </p>
                      </div>

                      <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row sm:gap-6 pt-0 sm:pt-1">
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-slate-200/80 pr-0 sm:border-r sm:pr-5">
                          <label
                            htmlFor="postcard-blessing"
                            className="text-xs sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 sm:mb-3 shrink-0"
                          >
                            {t.blessingLabel}
                          </label>
                          <div className="flex min-h-0 flex-1 flex-col justify-center">
                            <textarea
                              id="postcard-blessing"
                              placeholder={t.writeMessage}
                              value={message}
                              onChange={(e) => setMessage(e.target.value)}
                              className={`min-h-[6.5rem] sm:min-h-[8rem] w-full flex-1 resize-none rounded-md bg-transparent border-none focus:ring-0 focus:outline-none text-center text-base sm:text-lg md:text-xl text-slate-700 placeholder:text-slate-300 ${
                                /[\u4e00-\u9fff]/.test(message)
                                  ? 'font-chinese-handwritten'
                                  : 'font-handwritten'
                              }`}
                              style={{
                                lineHeight: '1.65rem',
                                backgroundAttachment: 'local',
                                backgroundImage: `repeating-linear-gradient(transparent, transparent 1.64rem, rgba(148, 163, 184, 0.14) 1.64rem, rgba(148, 163, 184, 0.14) calc(1.64rem + 1px))`,
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex w-full shrink-0 flex-col sm:min-w-[5.75rem] sm:max-w-[12rem] sm:w-[42%] sm:pt-1">
                          <div className="flex justify-end mb-5">
                            <div className="w-14 h-[4.6rem] md:w-[3.75rem] md:h-[4.75rem] border-2 border-dashed border-slate-300 rounded-sm flex items-center justify-center text-slate-400 bg-white/40">
                              <span className="text-[9px] font-medium uppercase tracking-widest -rotate-90 whitespace-nowrap">
                                {t.stamp}
                              </span>
                            </div>
                          </div>
                          <label
                            htmlFor="postcard-to"
                            className="text-xs sm:text-[11px] font-semibold text-slate-400 mb-1.5 sm:mb-2"
                          >
                            {t.toLabel}
                          </label>
                          <input
                            id="postcard-to"
                            type="text"
                            value={recipientName}
                            onChange={(e) => setRecipientName(e.target.value)}
                            placeholder={t.toPlaceholder}
                            className={`w-full bg-transparent border-b border-slate-300 focus:border-slate-600 focus:outline-none py-1.5 text-base sm:text-lg text-slate-800 placeholder:text-slate-300 placeholder:font-sans ${
                              /[\u4e00-\u9fff]/.test(recipientName)
                                ? 'font-chinese-handwritten'
                                : 'font-handwritten'
                            }`}
                          />
                          <div
                            className="min-h-[12px] flex-1 my-4 border-b border-dotted border-slate-200"
                            aria-hidden
                          />
                          <label
                            htmlFor="postcard-from"
                            className="text-xs sm:text-[11px] font-semibold text-slate-400 mb-1.5 sm:mb-2"
                          >
                            {t.fromLabel}
                          </label>
                          <input
                            id="postcard-from"
                            type="text"
                            value={senderName}
                            onChange={(e) => setSenderName(e.target.value)}
                            placeholder={t.fromPlaceholder}
                            className={`w-full bg-transparent border-b border-slate-300 focus:border-slate-600 focus:outline-none py-1.5 text-base sm:text-lg text-slate-800 placeholder:text-slate-300 placeholder:font-sans ${
                              /[\u4e00-\u9fff]/.test(senderName)
                                ? 'font-chinese-handwritten'
                                : 'font-handwritten'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsFlipped(false);
                      }}
                      className="relative z-10 flex items-center justify-center gap-2 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100/90 transition-colors border-t border-slate-200/70"
                    >
                      <ArrowRight className="rotate-180" size={14} aria-hidden />
                      {t.showFront}
                    </button>
                  </div>
                </motion.div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col items-center gap-4 sm:gap-6 w-full px-1">
                <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-4 w-full max-w-lg sm:max-w-none">
                  <button 
                    onClick={reset}
                    className="w-full sm:w-auto justify-center py-3 px-6 sm:px-8 rounded-full bg-white border border-slate-200 text-slate-600 text-sm sm:text-base font-medium hover:bg-slate-50 transition-all flex items-center gap-2"
                  >
                    <RefreshCw size={18} />
                    {t.backToStudio}
                  </button>

                  <div ref={downloadMenuRef} className="relative group/download">
                    <button
                      type="button"
                      aria-expanded={downloadMenuOpen}
                      aria-haspopup="menu"
                      onClick={() => {
                        if (window.matchMedia('(hover: none)').matches) {
                          setDownloadMenuOpen((o) => !o);
                        }
                      }}
                      className="w-full sm:w-auto justify-center py-3 px-6 sm:px-8 rounded-full bg-white border border-slate-200 text-slate-600 text-sm sm:text-base font-medium hover:bg-slate-50 transition-all flex items-center gap-2"
                    >
                      <Upload size={18} className="rotate-180 shrink-0" />
                      {t.download}
                      <ChevronDown size={16} />
                    </button>

                    <div
                      className={`absolute top-full left-1/2 z-50 mt-2 w-64 -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl transition-all ${
                        downloadMenuOpen
                          ? 'visible opacity-100'
                          : 'invisible opacity-0 md:group-hover/download:visible md:group-hover/download:opacity-100'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleDownload('stitched')}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                          <ImageIcon size={16} />
                        </div>
                        <div>
                          <p className="font-semibold">{t.downloadStitched}</p>
                          <p className="text-[10px] text-slate-400">Front + Back combined</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload('phantom')}
                        className="flex w-full items-center gap-3 border-t border-slate-50 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50"
                      >
                        <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                          <Sparkles size={16} />
                        </div>
                        <div>
                          <p className="font-semibold">{t.downloadHidden}</p>
                          <p className="text-[10px] text-slate-400">Hidden image (Phantom Tank)</p>
                        </div>
                      </button>
                    </div>
                  </div>
                  
                  {!isSent ? (
                    <button 
                      onClick={handleSendClick}
                      className="w-full sm:w-auto justify-center py-3 px-8 sm:px-10 rounded-full bg-slate-900 text-white text-sm sm:text-base font-semibold shadow-lg hover:bg-slate-800 hover:-translate-y-1 transition-all flex items-center gap-2"
                    >
                      <Send size={18} />
                      {t.sendByEmail}
                    </button>
                  ) : (
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="flex items-center gap-2 text-emerald-600 font-semibold bg-emerald-50 px-8 py-3 rounded-full border border-emerald-100"
                    >
                      <CheckCircle2 size={20} />
                      {t.sent}
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Email Modal/Input Overlay */}
              <AnimatePresence>
                {showEmailInput && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                  >
                    <motion.div 
                      initial={{ scale: 0.9, y: 20 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0.9, y: 20 }}
                      className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 w-full max-w-md shadow-2xl"
                    >
                      <h3 className="text-lg sm:text-xl font-semibold mb-2">{t.sendByEmail}</h3>
                      <p className="text-slate-500 mb-5 sm:mb-6 text-sm sm:text-base leading-relaxed">{language === 'zh' ? '输入收件人的电子邮件地址以邮寄这件水彩杰作。' : 'Enter the recipient\'s email address to mail this watercolor masterpiece.'}</p>
                      
                      <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3 border border-slate-200 mb-6">
                        <Mail size={20} className="text-slate-400" />
                        <input 
                          type="email" 
                          placeholder={t.enterEmail}
                          value={recipientEmail}
                          onChange={(e) => setRecipientEmail(e.target.value)}
                          className="flex-1 bg-transparent border-none focus:ring-0 text-base"
                          autoFocus
                        />
                      </div>

                      <div className="flex gap-3">
                        <button 
                          onClick={() => setShowEmailInput(false)}
                          className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-all"
                        >
                          {t.cancel}
                        </button>
                        <button 
                          disabled={!recipientEmail || isSending}
                          onClick={handleFinalSend}
                          className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-semibold shadow-lg hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isSending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                          {isSending ? t.sending : t.send}
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}

                {/* Envelope animation overlay removed as it's now part of the result flow */}
              </AnimatePresence>

              <p className="text-slate-400 text-xs sm:text-sm flex items-center justify-center gap-2 text-center px-2 leading-snug">
                <ArrowRight size={14} className="shrink-0" aria-hidden />
                {t.clickToFlip}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showRechargeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-start gap-3 mb-5 sm:mb-6">
                <div className="p-2.5 sm:p-3 rounded-2xl bg-amber-50 text-amber-600 shrink-0">
                  <Sparkles size={24} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-xl font-semibold">{t.rechargeTitle}</h3>
                  <p className="text-slate-500 text-sm sm:text-base leading-relaxed mt-1">{t.rechargeDesc}</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block ml-1">
                  {t.paymentMethod}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('link')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-2xl border transition-all ${
                      paymentMethod === 'link'
                        ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                        : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${paymentMethod === 'link' ? 'bg-blue-400' : 'bg-slate-300'}`}
                    />
                    <span className="font-semibold">{t.link}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('alipay')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-2xl border transition-all ${
                      paymentMethod === 'alipay'
                        ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                        : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${paymentMethod === 'alipay' ? 'bg-blue-500' : 'bg-slate-300'}`}
                    />
                    <span className="font-semibold">{t.alipay}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3 mb-8">
                {[
                  { price: 1, credits: 5, label: 'Starter' },
                  { price: 3, credits: 18, label: t.popular, bonus: language === 'zh' ? '节省 16%' : 'Save 16%' },
                  { price: 5, credits: 40, label: t.bestValue, bonus: language === 'zh' ? '节省 37%' : 'Save 37%' },
                ].map((pack) => (
                  <button
                    key={pack.price}
                    type="button"
                    onClick={() => handleRecharge(pack.price, pack.credits)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-slate-300 hover:shadow-md transition-all group"
                  >
                    <div className="text-left">
                      <p className="font-bold text-slate-800">
                        {pack.credits} {t.credits}
                      </p>
                      <p className="text-xs text-slate-400">{pack.label}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {pack.bonus && (
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">
                          {pack.bonus}
                        </span>
                      )}
                      <span className="font-bold text-slate-900 group-hover:scale-110 transition-transform">
                        ${pack.price}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowRechargeModal(false)}
                className="w-full py-3 rounded-xl border border-slate-200 text-slate-400 font-medium hover:text-slate-600 transition-all"
              >
                {t.cancel}
              </button>
            </motion.div>
          </motion.div>
        )}

        {showPasswordInput && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-5 sm:mb-6">
                <div className="p-2.5 sm:p-3 rounded-2xl bg-purple-50 text-purple-600 shrink-0">
                  <Sparkles size={24} />
                </div>
                <h3 className="text-lg sm:text-xl font-semibold leading-snug">{t.unlockCredits}</h3>
              </div>

              {soraEggUsed ? (
                <p className="text-amber-800/90 text-sm leading-relaxed mb-6">{t.soraEggAlreadyUsed}</p>
              ) : (
                <div className="bg-slate-50 rounded-2xl px-4 py-3 border border-slate-200 mb-6">
                  <input
                    type="password"
                    placeholder={t.enterPassword}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent border-none focus:ring-0 text-base"
                    autoFocus
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPasswordInput(false)}
                  className={`py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-all ${soraEggUsed ? 'w-full' : 'flex-1'}`}
                >
                  {t.cancel}
                </button>
                {!soraEggUsed && (
                  <button
                    type="button"
                    onClick={handleUnlockMagic}
                    className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-semibold shadow-lg hover:bg-slate-800 transition-all"
                  >
                    {t.send}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-10 sm:mt-16 py-6 sm:py-8 border-t border-slate-100 w-full flex flex-col md:flex-row justify-between items-center gap-3 sm:gap-4 text-slate-400 text-xs sm:text-sm px-1">
        <p>© 2026 {t.title}. Powered by AI.</p>
        <div className="flex gap-6">
          <a href="#" className="hover:text-slate-600 transition-colors">Privacy</a>
          <a href="#" className="hover:text-slate-600 transition-colors">Terms</a>
          <a href="#" className="hover:text-slate-600 transition-colors">Contact</a>
        </div>
      </footer>
    </div>
  );
}
