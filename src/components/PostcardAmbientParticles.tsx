import { useEffect, useRef } from 'react';

type ParticleKind = 'snow' | 'petal' | 'ember' | 'leaf' | 'star' | 'mote' | 'sparkle';

type Config = {
  kind: ParticleKind;
  count: number;
  colors: string[];
};

function configForHoliday(holidayId: string): Config | null {
  switch (holidayId) {
    case 'christmas':
      return { kind: 'snow', count: 72, colors: ['#ffffff', '#e8f4fc', '#dbeafe'] };
    case 'easter':
    case 'welcome':
    case 'valentine':
    case 'lunar-new-year':
      return {
        kind: 'petal',
        count: 48,
        colors:
          holidayId === 'valentine'
            ? ['#fbcfe8', '#fce7f3', '#fda4af', '#fff1f2']
            : holidayId === 'lunar-new-year'
              ? ['#fecaca', '#fef3c7', '#fce7f3', '#fff7ed']
              : ['#dcfce7', '#fef9c3', '#fce7f3', '#ffffff'],
      };
    case 'halloween':
      return { kind: 'ember', count: 40, colors: ['#fb923c', '#a855f7', '#f97316', '#fde047'] };
    case 'thanksgiving':
      return { kind: 'leaf', count: 36, colors: ['#d97706', '#b45309', '#ca8a04', '#92400e'] };
    case 'mid-autumn':
      return { kind: 'star', count: 42, colors: ['#fde68a', '#fef3c7', '#fcd34d', '#fffbeb'] };
    case 'farewell':
      return { kind: 'mote', count: 32, colors: ['#c4b5fd', '#ddd6fe', '#e9d5ff', '#f5f3ff'] };
    case 'custom':
    default:
      return { kind: 'sparkle', count: 28, colors: ['#ffffff', '#e2e8f0', '#f8fafc'] };
  }
}

type BaseParticle = { x: number; y: number; vx: number; vy: number; r: number; a: number; t: number };

export function PostcardAmbientParticles({
  holidayId,
  className = '',
  reducedMotion,
}: {
  holidayId: string;
  className?: string;
  reducedMotion?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<BaseParticle[]>([]);
  const cfgRef = useRef<Config | null>(null);

  useEffect(() => {
    if (reducedMotion) return;
    const cfg = configForHoliday(holidayId);
    cfgRef.current = cfg;
    if (!cfg) return;

    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const initParticles = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const kind = cfg.kind;
      const list: BaseParticle[] = [];
      for (let i = 0; i < cfg.count; i++) {
        const r = kind === 'snow' ? 0.8 + Math.random() * 2.2 : 1 + Math.random() * 3;
        list.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx:
            kind === 'snow'
              ? (Math.random() - 0.5) * 0.35
              : kind === 'petal'
                ? (Math.random() - 0.5) * 0.6
                : (Math.random() - 0.5) * 0.4,
          vy:
            kind === 'snow'
              ? 0.4 + Math.random() * 1.2
              : kind === 'petal'
                ? -0.15 + Math.random() * 0.5
                : kind === 'leaf'
                  ? 0.35 + Math.random() * 0.9
                  : kind === 'ember'
                    ? -0.3 - Math.random() * 0.8
                    : -0.1 + Math.random() * 0.25,
          r,
          a: 0.25 + Math.random() * 0.55,
          t: Math.random() * Math.PI * 2,
        });
      }
      particlesRef.current = list;
    };

    resize();
    initParticles();

    const ro = new ResizeObserver(() => {
      resize();
      initParticles();
    });
    ro.observe(wrap);

    const drawSnow = (p: BaseParticle, w: number, h: number) => {
      ctx.fillStyle = `rgba(255,255,255,${p.a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      p.y += p.vy;
      p.x += p.vx + Math.sin(p.t + performance.now() * 0.001) * 0.25;
      p.t += 0.02;
      if (p.y > h + 4) {
        p.y = -4;
        p.x = Math.random() * w;
      }
      if (p.x < -4) p.x = w + 4;
      if (p.x > w + 4) p.x = -4;
    };

    const drawPetal = (p: BaseParticle, w: number, h: number, colors: string[]) => {
      const c = colors[Math.floor(p.t * 3) % colors.length];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t);
      ctx.fillStyle = c;
      ctx.globalAlpha = p.a;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.4, p.r * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      p.x += p.vx + Math.sin(p.t) * 0.15;
      p.y += p.vy;
      p.t += 0.012;
      if (p.y > h + 8) {
        p.y = -8;
        p.x = Math.random() * w;
      }
      if (p.x < -8) p.x = w + 8;
      if (p.x > w + 8) p.x = -8;
    };

    const drawLeaf = (p: BaseParticle, w: number, h: number, colors: string[]) => {
      const c = colors[Math.floor(p.x) % colors.length];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t);
      ctx.fillStyle = c;
      ctx.globalAlpha = p.a;
      ctx.beginPath();
      ctx.moveTo(0, -p.r * 1.2);
      ctx.quadraticCurveTo(p.r, 0, 0, p.r * 1.4);
      ctx.quadraticCurveTo(-p.r, 0, 0, -p.r * 1.2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      p.y += p.vy;
      p.x += p.vx + Math.sin(p.t) * 0.4;
      p.t += 0.018;
      if (p.y > h + 6) {
        p.y = -6;
        p.x = Math.random() * w;
      }
    };

    const drawEmber = (p: BaseParticle, w: number, h: number, colors: string[]) => {
      const c = colors[Math.floor((p.x + p.y * 0.7 + p.t * 3) % 400) % colors.length];
      ctx.fillStyle = c;
      ctx.globalAlpha = p.a * (0.7 + 0.3 * Math.sin(performance.now() * 0.003 + p.t));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      p.y += p.vy;
      p.x += p.vx + Math.sin(p.t) * 0.2;
      p.t += 0.04;
      if (p.y < -8) {
        p.y = h + 4;
        p.x = Math.random() * w;
      }
    };

    const drawStar = (p: BaseParticle, w: number, h: number, colors: string[]) => {
      const c = colors[Math.floor(p.t * 2) % colors.length];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t * 0.5);
      ctx.fillStyle = c;
      ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(performance.now() * 0.002 + p.r));
      const s = p.r * 0.9;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const ang = (k * 4 * Math.PI) / 5 - Math.PI / 2;
        const px = Math.cos(ang) * s;
        const py = Math.sin(ang) * s;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      p.y += p.vy;
      p.x += p.vx;
      p.t += 0.008;
      if (p.y > h + 6) p.y = -6;
      if (p.x < -6) p.x = w + 6;
      if (p.x > w + 6) p.x = -6;
    };

    const drawMote = (p: BaseParticle, w: number, h: number, colors: string[]) => {
      const c = colors[Math.floor(p.r * 7) % colors.length];
      ctx.fillStyle = c;
      ctx.globalAlpha = p.a * 0.55;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      p.y += p.vy;
      p.x += p.vx;
      p.t += 0.01;
      if (p.y < -4) p.y = h + 4;
      if (p.y > h + 4) p.y = -4;
    };

    const drawSparkle = (p: BaseParticle, w: number, h: number, colors: string[]) => {
      const c = colors[Math.floor(p.t) % colors.length];
      ctx.strokeStyle = c;
      ctx.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(performance.now() * 0.004 + p.t));
      ctx.lineWidth = 0.8;
      const s = p.r;
      ctx.beginPath();
      ctx.moveTo(p.x - s, p.y);
      ctx.lineTo(p.x + s, p.y);
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x, p.y + s);
      ctx.stroke();
      ctx.globalAlpha = 1;
      p.y += p.vy;
      p.x += p.vx;
      p.t += 0.02;
      if (p.y > h + 4) {
        p.y = -4;
        p.x = Math.random() * w;
      }
    };

    const loop = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const c = cfgRef.current;
      if (!c || w < 2 || h < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      ctx.clearRect(0, 0, w, h);
      const list = particlesRef.current;
      for (const p of list) {
        switch (c.kind) {
          case 'snow':
            drawSnow(p, w, h);
            break;
          case 'petal':
            drawPetal(p, w, h, c.colors);
            break;
          case 'leaf':
            drawLeaf(p, w, h, c.colors);
            break;
          case 'ember':
            drawEmber(p, w, h, c.colors);
            break;
          case 'star':
            drawStar(p, w, h, c.colors);
            break;
          case 'mote':
            drawMote(p, w, h, c.colors);
            break;
          default:
            drawSparkle(p, w, h, c.colors);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [holidayId, reducedMotion]);

  if (reducedMotion) return null;

  return (
    <div ref={wrapRef} className={`pointer-events-none absolute inset-0 z-[5] overflow-hidden ${className}`} aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  );
}
