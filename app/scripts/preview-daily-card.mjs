#!/usr/bin/env node
/**
 * 开发用:把每日分享卡的三个板式渲染成 PNG 肉眼看(scripts/.preview/,不进构建)。
 * 做法:给 engine 一个「Ctx2D→SVG 记录器」,再 @resvg/resvg-js 栅格化。
 *   cd app && npx tsc -p tsconfig.smoke.json && node scripts/preview-daily-card.mjs
 * 字体宽度是近似(CJK≈1em、ASCII≈0.55em),只为预览排版,真机以 canvas measureText 为准。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js');
const C = require('../.smoke/pkg-exercise/engine/daily-card.js');
const V = require('../.smoke/engine/dailyVerdict.js');

/* ---------- 颜色/字体解析 ---------- */
function parseColor(c) {
  if (typeof c !== 'string') return { r: 0, g: 0, b: 0, a: 1 };
  c = c.trim();
  const rgba = /rgba?\(([^)]+)\)/.exec(c);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map((x) => parseFloat(x.trim()));
    return { r, g, b, a };
  }
  const hex = c.replace('#', '');
  const n = parseInt(hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
}
const cssColor = (c) => {
  const { r, g, b, a } = parseColor(c);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
};
/** 近似测宽:CJK 全宽,ASCII 窄,空格更窄 */
function textWidth(t, size) {
  let w = 0;
  for (const ch of String(t)) {
    if (/[ ，。、·—…「」『』（）]/.test(ch)) w += /[，。、·—…「」『』（）]/.test(ch) ? 1 : 0.5;
    else if (ch.charCodeAt(0) > 0x2e7f) w += 1;           // CJK
    else if (/[ilkj|!'.:,·]/.test(ch)) w += 0.3;
    else if (/[0-9a-zA-Z]/.test(ch)) w += 0.56;
    else w += 0.5;
  }
  return w * size;
}

/* ---------- Ctx2D → SVG 记录器 ---------- */
function makeCtx(W, H) {
  const parts = [];
  const grads = [];
  let path = [];
  let open = false; // 当前子路径是否已开始(M/L 之后);arc 接续用 L 才不会断出毛边
  let fillStyle = '#000';
  let strokeStyle = '#000';
  let lineWidth = 1;
  let lineCap = '';
  let lineJoin = '';
  let font = '400 28px sans-serif';
  let textAlign = 'left';
  let textBaseline = 'alphabetic';
  const stack = [];

  const cur = () => {
    const m = /^(\d+)\s+(\d+(?:\.\d+)?)px\s+(.+)$/.exec(font) || [null, '400', '28', 'sans-serif'];
    return { weight: m[1], size: parseFloat(m[2]), family: m[3].replace(/sans-serif/, '"Microsoft YaHei", "Noto Sans SC", sans-serif') };
  };
  const fillOf = (c) => (c && typeof c === 'object' && c.__id) ? `url(#${c.__id})` : cssColor(c);
  const flushPath = (op = 'fill') => {
    if (!path.length) return;
    const paint = op === 'stroke'
      ? `fill="none" stroke="${fillOf(strokeStyle)}" stroke-width="${lineWidth}"${lineCap ? ` stroke-linecap="${lineCap}"` : ''}${lineJoin ? ` stroke-linejoin="${lineJoin}"` : ''}`
      : `fill="${fillOf(fillStyle)}"`;
    parts.push(`<path d="${path.join(' ')}" ${paint}/>`);
    path = [];
    open = false;
  };
  const api = {
    get fillStyle() { return fillStyle; },
    set fillStyle(v) { flushPath(); fillStyle = v; },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(v) { flushPath(); strokeStyle = v; },
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    createLinearGradient(x0, y0, x1, y1) {
      const id = `grad${grads.length}`;
      const stops = [];
      grads.push({ id, x0, y0, x1, y1, stops });
      return { addColorStop: (o, c) => stops.push([o, c]), __id: id };
    },
    save() { stack.push({ fillStyle, strokeStyle, lineWidth, lineCap, lineJoin, font, textAlign, textBaseline }); },
    restore() { const s = stack.pop(); if (s) ({ fillStyle, strokeStyle, lineWidth, lineCap, lineJoin, font, textAlign, textBaseline } = s); },
    beginPath() { flushPath(); },
    moveTo(x, y) { path.push(`M${x.toFixed(1)} ${y.toFixed(1)}`); open = true; },
    lineTo(x, y) { if (!open) { path.push(`M${x.toFixed(1)} ${y.toFixed(1)}`); open = true; } path.push(`L${x.toFixed(1)} ${y.toFixed(1)}`); },
    arc(x, y, r, a0, a1) {
      const p = (deg) => `${(x + r * Math.cos(deg)).toFixed(1)} ${(y + r * Math.sin(deg)).toFixed(1)}`;
      // 整圆:SVG 规定起点=终点的弧会被整个丢掉,拆成两个半弧
      if (Math.abs(a1 - a0) >= 2 * Math.PI - 1e-6) {
        path.push(`${open ? 'L' : 'M'}${p(0)}`);
        path.push(`A${r} ${r} 0 0 1 ${p(Math.PI)}`);
        path.push(`A${r} ${r} 0 0 1 ${p(2 * Math.PI)}`);
        open = true;
        return;
      }
      path.push(`${open ? 'L' : 'M'}${p(a0)}`);
      open = true;
      const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
      const sweep = a1 > a0 ? 1 : 0;
      path.push(`A${r} ${r} 0 ${large} ${sweep} ${p(a1)}`);
    },
    closePath() { path.push('Z'); open = false; },
    fill() { flushPath('fill'); },
    stroke() { flushPath('stroke'); },
    fillRect(x, y, w, h) { flushPath(); parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fillOf(fillStyle)}"/>`); },
    fillText(t, x, y) {
      flushPath();
      const { weight, size, family } = cur();
      const anchor = textAlign === 'center' ? 'middle' : textAlign === 'right' || textAlign === 'end' ? 'end' : 'start';
      let dy = 0;
      if (textBaseline === 'middle') dy = size * 0.36;
      else if (textBaseline === 'top') dy = size * 0.88;
      else if (textBaseline === 'alphabetic') dy = 0;
      parts.push(`<text x="${x}" y="${y + dy}" font-family='${family}' font-size="${size}" font-weight="${weight}" fill="${fillOf(fillStyle)}" text-anchor="${anchor}">${String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
    },
    measureText(t) { const { size } = cur(); return { width: textWidth(t, size) }; },
    drawImage(src, dx, dy, dw, dh) {
      flushPath();
      parts.push(`<image x="${dx}" y="${dy}" width="${dw}" height="${dh}" href="${String(src)}"/>`);
    }
  };
  Object.defineProperty(api, 'font', {
    get: () => font,
    set: (v) => { flushPath(); font = v; }
  });
  Object.defineProperty(api, 'textAlign', { get: () => textAlign, set: (v) => { textAlign = v; } });
  Object.defineProperty(api, 'textBaseline', { get: () => textBaseline, set: (v) => { textBaseline = v; } });
  Object.defineProperty(api, 'lineWidth', { get: () => lineWidth, set: (v) => { lineWidth = v; } });
  Object.defineProperty(api, 'lineCap', { get: () => lineCap, set: (v) => { lineCap = v; } });
  Object.defineProperty(api, 'lineJoin', { get: () => lineJoin, set: (v) => { lineJoin = v; } });
  return {
    api,
    svg() {
      flushPath();
      const defs = grads.length
        ? `<defs>${grads.map((g) => `<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}">${g.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${cssColor(c)}"/>`).join('')}</linearGradient>`).join('')}</defs>`
        : '';
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${parts.join('\n')}</svg>`;
    }
  };
}

/* ---------- 出图 ---------- */
const OUT = resolve(HERE, '.preview');
mkdirSync(OUT, { recursive: true });

function render(name, draw) {
  const rec = makeCtx(C.DAILY_W, C.DAILY_H);
  draw(rec.api);
  const png = new Resvg(rec.svg(), { fitTo: { mode: 'width', value: C.DAILY_W } }).render().asPng();
  writeFileSync(resolve(OUT, name), png);
  console.log('wrote', name, png.length, 'B');
}

const days = {
  good: V.dailyVerdict({
    intakeCalories: 1840, kcalTarget: 2000, proteinG: 118, proteinTargetG: 115,
    steps: 8620, stepGoal: 8000, training: { title: '推 · 胸肩三头', minutes: 62, sets: 14 }
  }),
  bad: V.dailyVerdict({
    intakeCalories: 470, kcalTarget: 2000, proteinG: 18, proteinTargetG: 115,
    steps: 1200, stepGoal: 8000, training: null
  }),
  empty: V.dailyVerdict({
    intakeCalories: 1580, kcalTarget: 0, proteinG: 72, proteinTargetG: 0,
    steps: 0, stepGoal: 0, training: null
  })
};
const QUOTE = { text: '白天沙拉,深夜烧烤——身体都替你记着账呢', sub: '看得见的摄入,才管得住' };

for (const key of C.CARD_STYLE_KEYS) {
  const style = C.CARD_STYLES[key];
  render(`daily-${key}-report.png`, (ctx) => C.drawReport(ctx, { dateLabel: '10月25日 · 周日', verdict: days.good, recordDays: 9 }, {}, style));
  render(`daily-${key}-quote.png`, (ctx) => C.drawQuote(ctx, { dateLabel: '10月25日 · 周日', quote: QUOTE, recordDays: 9 }, {}, style));
}
// 默认板式(墨绿刊)再看两种数据形态:糟糕的一天 / 没设目标
render('daily-forest-report-bad.png', (ctx) => C.drawReport(ctx, { dateLabel: '10月25日 · 周日', verdict: days.bad, recordDays: 9 }, {}, C.CARD_STYLES.forest));
render('daily-forest-report-empty.png', (ctx) => C.drawReport(ctx, { dateLabel: '10月25日 · 周日', verdict: days.empty, recordDays: 9 }, {}, C.CARD_STYLES.forest));
console.log('全部出图完成 →', OUT);
