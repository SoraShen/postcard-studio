/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, ChangeEvent, useCallback } from 'react';
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
    rechargeDesc: "Choose a plan to continue creating magical postcards.",
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
    downloadStitched: "Download Stitched (PNG)",
    downloadHidden: "Download Hidden (Phantom Tank)",
    downloadMode: "Download Mode"
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
    toLabel: "收件人",
    fromLabel: "寄信人",
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
    rechargeDesc: "选择一个方案以继续创作魔幻明信片。",
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
    downloadStitched: "下载拼接图 (PNG)",
    downloadHidden: "下载隐藏图 (幻影坦克)",
    downloadMode: "下载模式"
  }
};

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
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isSent, setIsSent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [credits, setCredits] = useState(8);
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'link' | 'alipay'>('link');
  /** Fixed on-image title position for the AI prompt (no drag UI). */
  const textPositionPct = { x: 50, y: 66.6 };
  const [textSize, setTextSize] = useState(24);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [password, setPassword] = useState("");
  const [isMagicActive, setIsMagicActive] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  const t = TRANSLATIONS[language];
  
  // Cropping State
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const result = reader.result as string;
        
        // Initial compression to keep UI responsive and memory usage low
        try {
          const img = await createImage(result);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            setUploadedImage(result);
            setIsCropping(true);
            return;
          }

          // Limit initial upload to 2048px to avoid browser lag
          const MAX_UPLOAD_DIM = 2048;
          let width = img.width;
          let height = img.height;
          if (width > MAX_UPLOAD_DIM || height > MAX_UPLOAD_DIM) {
            const scale = MAX_UPLOAD_DIM / Math.max(width, height);
            width *= scale;
            height *= scale;
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          setUploadedImage(canvas.toDataURL('image/jpeg', 0.9));
        } catch (err) {
          setUploadedImage(result);
        }
        
        setIsCropping(true);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const createImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve(image));
      image.addEventListener('error', (error) => reject(error));
      image.setAttribute('crossOrigin', 'anonymous');
      image.src = url;
    });

  const getCroppedImg = async (imageSrc: string, pixelCrop: Area): Promise<string | null> => {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    // Pre-processing: Limit maximum dimensions to 1024px to save tokens and time
    const MAX_DIMENSION = 1024;
    let targetWidth = pixelCrop.width;
    let targetHeight = pixelCrop.height;

    if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(targetWidth, targetHeight);
      targetWidth *= scale;
      targetHeight *= scale;
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

    // Use JPEG with 0.8 quality for good balance between size and quality
    return canvas.toDataURL('image/jpeg', 0.8);
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

      const parsed = parseDataUrlImage(uploadedImage);
      if (!parsed?.base64) {
        setError(
          language === 'zh' ? '图片数据无效，请重新上传。' : 'Invalid image data. Please upload again.'
        );
        return;
      }

      const holidayName = selectedHoliday.id === 'custom' ? customTheme : selectedHoliday.name;
      const defaultBlessing = language === 'zh' ? selectedHoliday.zhShortBlessing : selectedHoliday.shortBlessing;
      const blessingToUse = customBlessing.trim() || defaultBlessing;
      const sceneElements = selectedHoliday.id === 'custom' ? (customKeywords || selectedHoliday.elements) : selectedHoliday.elements;

      const hasChinese = (str: string) => /[\u4e00-\u9fa5]/.test(str);
      const useChineseCalligraphy = hasChinese(holidayName) || hasChinese(blessingToUse) || language === 'zh';

      const getVerticalPos = (y: number) => (y < 33 ? 'top' : y < 66 ? 'middle' : 'bottom');
      const getHorizontalPos = (x: number) => (x < 33 ? 'left' : x < 66 ? 'center' : 'right');
      const positionDesc = `${getVerticalPos(textPositionPct.y)}-${getHorizontalPos(textPositionPct.x)}`;

      const prompt = `Transform this photo into a beautiful, ${selectedStyle.promptSuffix} for ${holidayName}. 
      Incorporate ${sceneElements} into the scene. 
      
      CRITICAL TEXT INSTRUCTIONS:
      1. Render the word "${holidayName}" in a large, elegant font that matches the ${selectedStyle.name} style. 
      ${useChineseCalligraphy ? '2. IMPORTANT: Since the text is in Chinese, use elegant Chinese "Xing-shu" (Running Script) calligraphy style for the characters.' : '2. Use a beautiful vintage script font for the text.'}
      3. This word must be placed at the ${positionDesc} of the image.
      4. MANDATORY: Directly below "${holidayName}", add a clear and legible line of text that says: "${blessingToUse}". 
      5. The size of the text should be approximately ${textSize}pt in scale relative to the image.
      6. The text must be rendered in a style that blends naturally into the background, matching the ${selectedStyle.name} aesthetic (e.g., if watercolor, it should bleed; if sketch, it should look like ink; if Ghibli, it should look like hand-painted cel art).
      7. The entire composition (image and text) must feel like a single, cohesive piece of art.
      8. Ensure both "${holidayName}" and "${blessingToUse}" are clearly visible and not cut off.`;

      let resultDataUrl: string;

      if (useProxy) {
        if (workerBase) {
          resultDataUrl = await runGeminiPostcardViaWorkerRest(workerBase, {
            imageBase64: parsed.base64,
            mimeType: parsed.mimeType,
            prompt,
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
        });
      }

      setGeneratedImage(resultDataUrl);
      setCredits((prev) => prev - 5);
    } catch (err: unknown) {
      console.error('Generation error:', err);

      const raw = formatGenaiError(err).toLowerCase();
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
        userFriendlyError =
          language === 'zh'
            ? 'API 密钥无效或无权使用该模型，请检查 Google AI Studio 中的密钥与账单。'
            : 'Invalid API key or permission denied. Check your key and billing in Google AI Studio.';
        if (raw.includes('not found') || raw.includes('permission')) {
          setHasApiKey(false);
        }
      } else if (raw.includes('not found') || raw.includes('404') || raw.includes('does not exist')) {
        userFriendlyError =
          language === 'zh'
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
  };

  const handleEasterEggClick = () => {
    setShowEasterEgg(false);
    setShowPasswordInput(true);
  };

  const handleUnlockMagic = () => {
    if (password.toLowerCase() === 'alex') {
      setIsMagicActive(true);
      playSound('magic');
      setCredits(prev => prev + 99);
      setShowPasswordInput(false);
      setPassword("");
      setTimeout(() => setIsMagicActive(false), 3000);
    } else {
      setPassword("");
    }
  };

  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const handleSoraTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      setShowEasterEgg(true);
    }, 1500);
  };
  const handleSoraTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  return (
    <div className={`min-h-screen flex flex-col items-center p-4 md:p-8 max-w-5xl mx-auto ${isMagicActive ? 'animate-pulse bg-gradient-to-r from-purple-100 via-pink-100 to-amber-100' : ''}`}>
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
      <header className="w-full flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl bg-white shadow-sm border border-slate-100 ${selectedHoliday.accentColor}`}>
              <Sparkles size={28} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight select-none">
              <span 
                onMouseDown={generatedImage ? handleSoraTouchStart : undefined}
                onMouseUp={generatedImage ? handleSoraTouchEnd : undefined}
                onTouchStart={generatedImage ? handleSoraTouchStart : undefined}
                onTouchEnd={generatedImage ? handleSoraTouchEnd : undefined}
                className={`${generatedImage ? 'cursor-help hover:text-amber-500 transition-colors' : ''}`}
              >
                Sora
              </span>
              {language === 'zh' ? '的明信片工坊' : "'s Postcard Studio"}
            </h1>
            
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
          
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-slate-100 shadow-sm">
            <div className="flex items-center gap-1.5 text-amber-600 font-bold">
              <Sparkles size={16} />
              <span>{credits} {t.credits}</span>
            </div>
            <button 
              onClick={() => setShowRechargeModal(true)}
              className="ml-2 text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-wider"
            >
              {t.topUp}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
            className="px-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-medium shadow-sm hover:bg-slate-50 transition-all"
          >
            {language === 'en' ? '中文' : 'English'}
          </button>

          <div className="relative group">
              <select 
                value={selectedHoliday.id}
                onChange={(e) => {
                  const holiday = HOLIDAYS.find(h => h.id === e.target.value);
                  if (holiday) setSelectedHoliday(holiday);
                }}
                className="appearance-none bg-white border border-slate-200 rounded-full px-6 py-2.5 pr-12 shadow-sm hover:border-slate-300 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-200 font-medium"
              >
                {HOLIDAYS.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.emoji} {language === 'zh' ? h.zhName : h.name}
                  </option>
                ))}
              </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" size={18} />
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
                <div className="text-center">
                  <p className="text-lg font-medium text-slate-700">{t.uploadPhoto}</p>
                  <p className="text-sm text-slate-400 mt-1">{t.dragDrop}</p>
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
              className="w-full max-w-2xl flex flex-col items-center gap-6"
            >
              <div className="relative aspect-[4/3] w-full rounded-3xl overflow-hidden shadow-2xl border-8 border-white bg-slate-900">
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
              
              <div className="w-full flex flex-col gap-6 bg-white p-6 rounded-3xl shadow-sm">
                <div className="flex flex-col gap-3">
                  <span className="text-sm font-medium text-slate-500 ml-1">{t.aspectRatio || 'Aspect Ratio'}</span>
                  <div className="flex flex-wrap gap-2">
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
                        className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${
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

                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-slate-500">{t.zoom}</span>
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
              className="w-full max-w-2xl flex flex-col items-center gap-8"
            >
              <div 
                style={{ aspectRatio: aspectRatio || '4/3' }}
                className="relative w-full rounded-3xl overflow-hidden shadow-2xl border-8 border-white"
              >
                <img src={uploadedImage} alt="Preview" className="w-full h-full object-cover select-none" />
                
                {/* Text preview overlay (position matches AI prompt) */}
                <motion.div 
                  style={{ 
                    left: `${textPositionPct.x}%`, 
                    top: `${textPositionPct.y}%`,
                    x: "-50%",
                    y: "-50%"
                  }}
                  className="absolute z-10 p-4 bg-white/20 backdrop-blur-md border border-white/30 rounded-xl flex flex-col items-center text-center shadow-lg pointer-events-none"
                >
                  <p 
                    style={{ fontSize: `${textSize}px` }}
                    className="font-serif italic text-white drop-shadow-md leading-none"
                  >
                    {selectedHoliday.id === 'custom' ? (customTheme || t.customTheme) : (language === 'zh' ? selectedHoliday.zhName : selectedHoliday.name)}
                  </p>
                  <p 
                    style={{ fontSize: `${textSize * 0.5}px` }}
                    className="text-white/80 drop-shadow-md mt-1 max-w-[120px] line-clamp-1"
                  >
                    {customBlessing.trim() || (language === 'zh' ? selectedHoliday.zhShortBlessing : selectedHoliday.shortBlessing)}
                  </p>
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full animate-pulse" />
                </motion.div>

                <button 
                  onClick={() => setUploadedImage(null)}
                  className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-colors z-20"
                >
                  <RefreshCw size={20} />
                </button>
              </div>

              <div className="w-full flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-500 ml-2">{t.selectStyle}</label>
                  <div className="grid grid-cols-3 gap-3">
                    {STYLES.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setSelectedStyle(style)}
                        className={`py-3 px-2 rounded-2xl text-sm font-medium transition-all border-2 ${
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

                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center px-2">
                    <label className="text-sm font-medium text-slate-500">{t.textSize}</label>
                    <span className="text-xs font-bold text-slate-400">{textSize}px</span>
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
                      <label className="text-sm font-medium text-slate-500 ml-2">{t.customTheme}</label>
                      <input 
                        type="text"
                        placeholder={t.themePlaceholder}
                        value={customTheme}
                        onChange={(e) => setCustomTheme(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-2xl px-6 py-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-slate-500 ml-2">{t.sceneKeywords}</label>
                      <input 
                        type="text"
                        placeholder={t.scenePlaceholder}
                        value={customKeywords}
                        onChange={(e) => setCustomKeywords(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-2xl px-6 py-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                      />
                    </div>
                  </>
                )}

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-500 ml-2">{t.customBlessing}</label>
                  <input 
                    type="text"
                    placeholder={language === 'zh' ? selectedHoliday.zhPlaceholder : selectedHoliday.placeholder}
                    value={customBlessing}
                    onChange={(e) => setCustomBlessing(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-2xl px-6 py-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                  />
                </div>

                <div className="flex flex-col items-center gap-4 w-full">
                  <button 
                    onClick={handleGenerate}
                    className={`w-full max-w-xs py-4 px-8 rounded-full bg-slate-900 text-white font-semibold shadow-xl hover:bg-slate-800 hover:-translate-y-1 transition-all flex items-center justify-center gap-3`}
                  >
                    <Sparkles size={20} />
                    {t.createCard.replace('{name}', language === 'zh' ? selectedHoliday.zhName : selectedHoliday.name)}
                  </button>
                  {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
                </div>
              </div>
            </motion.div>
          )}

          {isGenerating && (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-8"
            >
              <div className="relative w-32 h-32">
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
              <div className="text-center">
                <h2 className="text-2xl font-serif italic text-slate-800">{t.magicalPainting}</h2>
                <p className="text-slate-400 mt-2">{t.aiCrafting}</p>
              </div>
            </motion.div>
          )}

              {generatedImage && !isGenerating && (
                <motion.div 
                  key="result"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-3xl flex flex-col items-center gap-12 mt-6"
                >
                  {/* 3D Card */}
                  <div 
                    className="perspective-1000 w-full max-w-2xl relative group"
                    style={{ aspectRatio: aspectRatio || '4/3' }}
                  >
                {/* Flip Hint */}
                <AnimatePresence>
                  {!isFlipped && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute -top-12 left-1/2 -translate-x-1/2 z-10 bg-slate-900/80 backdrop-blur-md text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 pointer-events-none shadow-lg"
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
                  {/* Front */}
                  <div className="absolute inset-0 backface-hidden rounded-none shadow-2xl overflow-hidden bg-white p-4 md:p-6 border border-slate-100">
                    <div className="w-full h-full rounded-none overflow-hidden relative border-[8px] border-white shadow-inner">
                      <img src={generatedImage} alt="Watercolor Postcard" className="w-full h-full object-cover" />
                    </div>
                  </div>

                  {/* Back — layout mirrors drawPostcardBack() for downloads */}
                  <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-none shadow-2xl bg-[#fffdfa] border border-slate-100 flex flex-col overflow-hidden">
                    <div
                      className="pointer-events-none absolute inset-0 opacity-[0.04] bg-[repeating-linear-gradient(transparent,transparent_1.75rem,rgba(100,116,139,0.35)_1.75rem,rgba(100,116,139,0.35)_calc(1.75rem+1px))]"
                      aria-hidden
                    />
                    <div
                      className="relative flex flex-col flex-1 min-h-0 p-5 md:p-7"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex justify-between items-end gap-3 border-b border-slate-200/90 pb-3 mb-6 shrink-0">
                        <div>
                          <p className="text-[10px] font-semibold tracking-[0.26em] text-slate-400 uppercase">
                            {t.postcardMark}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1 leading-snug max-w-[11rem] md:max-w-none">
                            {t.postcardHint}
                          </p>
                        </div>
                        <p className="font-serif italic text-base md:text-lg text-slate-700 text-right leading-tight shrink-0">
                          {language === 'zh' ? selectedHoliday.zhName : selectedHoliday.name}{' '}
                          <span className="text-slate-400 not-italic text-sm font-sans">2026</span>
                        </p>
                      </div>

                      <div className="flex min-h-0 flex-1 flex-col gap-5 sm:flex-row sm:gap-6 pt-1">
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-slate-200/80 pr-0 sm:border-r sm:pr-5">
                          <label
                            htmlFor="postcard-blessing"
                            className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3 shrink-0"
                          >
                            {t.blessingLabel}
                          </label>
                          <div className="flex min-h-0 flex-1 flex-col justify-center">
                            <textarea
                              id="postcard-blessing"
                              placeholder={t.writeMessage}
                              value={message}
                              onChange={(e) => setMessage(e.target.value)}
                              className={`min-h-[8rem] w-full flex-1 resize-none rounded-md bg-transparent border-none focus:ring-0 focus:outline-none text-center text-lg md:text-xl text-slate-700 placeholder:text-slate-300 ${
                                /[\u4e00-\u9fff]/.test(message)
                                  ? 'font-chinese-handwritten'
                                  : 'font-handwritten'
                              }`}
                              style={{
                                lineHeight: '1.75rem',
                                backgroundAttachment: 'local',
                                backgroundImage: `repeating-linear-gradient(transparent, transparent 1.74rem, rgba(148, 163, 184, 0.14) 1.74rem, rgba(148, 163, 184, 0.14) calc(1.74rem + 1px))`,
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
                            className="text-[11px] font-semibold text-slate-400 mb-2"
                          >
                            {t.toLabel}
                          </label>
                          <input
                            id="postcard-to"
                            type="text"
                            value={recipientName}
                            onChange={(e) => setRecipientName(e.target.value)}
                            placeholder={t.toPlaceholder}
                            className={`w-full bg-transparent border-b border-slate-300 focus:border-slate-600 focus:outline-none py-1.5 text-base md:text-lg text-slate-800 placeholder:text-slate-300 placeholder:font-sans ${
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
                            className="text-[11px] font-semibold text-slate-400 mb-2"
                          >
                            {t.fromLabel}
                          </label>
                          <input
                            id="postcard-from"
                            type="text"
                            value={senderName}
                            onChange={(e) => setSenderName(e.target.value)}
                            placeholder={t.fromPlaceholder}
                            className={`w-full bg-transparent border-b border-slate-300 focus:border-slate-600 focus:outline-none py-1.5 text-base md:text-lg text-slate-800 placeholder:text-slate-300 placeholder:font-sans ${
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
                      className="relative z-10 flex items-center justify-center gap-2 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100/90 transition-colors border-t border-slate-200/70"
                    >
                      <ArrowRight className="rotate-180" size={14} aria-hidden />
                      {t.showFront}
                    </button>
                  </div>
                </motion.div>
              </div>

              {/* Actions */}
              <div className="flex flex-col items-center gap-6 w-full">
                <div className="flex flex-wrap justify-center gap-4 w-full">
                  <button 
                    onClick={reset}
                    className="py-3 px-8 rounded-full bg-white border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-all flex items-center gap-2"
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
                      className="py-3 px-8 rounded-full bg-white border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-all flex items-center gap-2"
                    >
                      <Upload size={18} className="rotate-180" />
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
                      className="py-3 px-10 rounded-full bg-slate-900 text-white font-semibold shadow-lg hover:bg-slate-800 hover:-translate-y-1 transition-all flex items-center gap-2"
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
                      className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
                    >
                      <h3 className="text-xl font-semibold mb-2">{t.sendByEmail}</h3>
                      <p className="text-slate-500 mb-6 text-sm">{language === 'zh' ? '输入收件人的电子邮件地址以邮寄这件水彩杰作。' : 'Enter the recipient\'s email address to mail this watercolor masterpiece.'}</p>
                      
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

                {showRechargeModal && (
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
                      className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
                    >
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 rounded-2xl bg-amber-50 text-amber-600">
                          <Sparkles size={24} />
                        </div>
                        <div>
                          <h3 className="text-xl font-semibold">{t.rechargeTitle}</h3>
                          <p className="text-slate-500 text-sm">{language === 'zh' ? '每次生成消耗 5 积分。' : 'Each generation costs 5 credits.'}</p>
                        </div>
                      </div>

                      <div className="mb-6">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block ml-1">{t.paymentMethod}</label>
                        <div className="grid grid-cols-2 gap-3">
                          <button 
                            onClick={() => setPaymentMethod('link')}
                            className={`flex items-center justify-center gap-2 py-3 rounded-2xl border transition-all ${
                              paymentMethod === 'link' 
                                ? 'bg-slate-900 text-white border-slate-900 shadow-md' 
                                : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-200'
                            }`}
                          >
                            <div className={`w-2 h-2 rounded-full ${paymentMethod === 'link' ? 'bg-blue-400' : 'bg-slate-300'}`} />
                            <span className="font-semibold">{t.link}</span>
                          </button>
                          <button 
                            onClick={() => setPaymentMethod('alipay')}
                            className={`flex items-center justify-center gap-2 py-3 rounded-2xl border transition-all ${
                              paymentMethod === 'alipay' 
                                ? 'bg-slate-900 text-white border-slate-900 shadow-md' 
                                : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-200'
                            }`}
                          >
                            <div className={`w-2 h-2 rounded-full ${paymentMethod === 'alipay' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                            <span className="font-semibold">{t.alipay}</span>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3 mb-8">
                        {[
                          { price: 1, credits: 5, label: "Starter" },
                          { price: 3, credits: 18, label: t.popular, bonus: language === 'zh' ? "节省 16%" : "Save 16%" },
                          { price: 5, credits: 40, label: t.bestValue, bonus: language === 'zh' ? "节省 37%" : "Save 37%" }
                        ].map((pack) => (
                          <button
                            key={pack.price}
                            onClick={() => handleRecharge(pack.price, pack.credits)}
                            className="w-full flex items-center justify-between p-4 rounded-2xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-slate-300 hover:shadow-md transition-all group"
                          >
                            <div className="text-left">
                              <p className="font-bold text-slate-800">{pack.credits} {t.credits}</p>
                              <p className="text-xs text-slate-400">{pack.label}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              {pack.bonus && (
                                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">
                                  {pack.bonus}
                                </span>
                              )}
                              <span className="font-bold text-slate-900 group-hover:scale-110 transition-transform">${pack.price}</span>
                            </div>
                          </button>
                        ))}
                      </div>

                      <button 
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
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                  >
                    <motion.div 
                      initial={{ scale: 0.9, y: 20 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0.9, y: 20 }}
                      className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
                    >
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 rounded-2xl bg-purple-50 text-purple-600">
                          <Sparkles size={24} />
                        </div>
                        <h3 className="text-xl font-semibold">{t.unlockCredits}</h3>
                      </div>
                      
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

                      <div className="flex gap-3">
                        <button 
                          onClick={() => setShowPasswordInput(false)}
                          className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-all"
                        >
                          {t.cancel}
                        </button>
                        <button 
                          onClick={handleUnlockMagic}
                          className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-semibold shadow-lg hover:bg-slate-800 transition-all"
                        >
                          {t.send}
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}

                {/* Envelope animation overlay removed as it's now part of the result flow */}
              </AnimatePresence>

              <p className="text-slate-400 text-sm flex items-center gap-2">
                <ArrowRight size={14} />
                {t.clickToFlip}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-16 py-8 border-t border-slate-100 w-full flex flex-col md:flex-row justify-between items-center gap-4 text-slate-400 text-sm">
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
