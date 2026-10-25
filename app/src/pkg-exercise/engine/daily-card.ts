/**
 * 每日分享卡(今日成绩单 / 金句)的绘制引擎 —— 排版计算与绘制分离,前者可单测。
 *
 * 逻辑尺寸 750×1334(9:16,朋友圈点开全屏刚好),真机上先 ctx.scale(dpr, dpr)。
 *
 * 板式(用户可在分享页挑):同一种版面骨架,三种性格,由 CardStyle 令牌驱动 ——
 *   forest 墨绿刊:深绿渐变满底 + 米白眉题 + 琥珀徽记,最「压得住」的一版;
 *   paper  暖纸手账:暖纸底 + 绿色水洗晕染,卡片浮在上面;
 *   clean  极简白:纯白 + 细线框 + 直角卡,印刷感。
 * 背景不再用图片(旧水彩 JPG 右下角带着生成器水印,而且偏淡),
 * 全部代码绘制:无水印、颜色可控、包体还省一张图。
 */

import type { DailyVerdict } from '../../engine/dailyVerdict';

export const DAILY_W = 750;
export const DAILY_H = 1334;

/** 白卡与正文的安全宽度:大字标题、金句折行都用它 */
export const TEXT_W = 544;

/** 渐变对象的最小形状(真机 canvas 与预览记录器都给得起;单测假 ctx 可以不给) */
interface GradLike {
  addColorStop(off: number, color: string): void;
}

/** 只列用到的几个方法,单测好造假 ctx */
export interface Ctx2D {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  createLinearGradient?(x0: number, y0: number, x1: number, y1: number): GradLike;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

const INK = '#0f4a3a';
const INK_STRONG = '#104d3b';
const SUB = '#52705f';
const EYEBROW = '#5c6f64';
const COMMENT = '#42604f';
const PAPER = '#fffefa';
const BAR_TRACK = '#ece7d8';
const BAR_FLAT = '#e3dece';
const STATUS_COLOR: Record<string, string> = {
  ok: '#1d7a5e',
  warn: '#c89a3c',
  bad: '#c25b4a',
  none: '#b9c4ba'
};

/* 白卡的几何:全卡内容都挂在这几个数上 */
const CARD_X = 55;
const CARD_Y = 168;
const CARD_W = 640;
const CARD_H = 768;
const PAD_L = 134;   // 正文左界(给圆点让位)
const PAD_R = 661;   // 正文右界(数值右对齐到这里)
const BAND_Y = 1128; // 页脚条顶

export interface CardImages {
  qr?: unknown;
}

export interface ReportCardData {
  dateLabel: string;
  verdict: DailyVerdict;
  /** 注册日到今天(第几天);0 = 不画这行印记 */
  recordDays: number;
}

export interface QuoteCardData {
  dateLabel: string;
  quote: { text: string; sub: string };
  recordDays: number;
}

/* ============ 板式令牌 ============ */

export interface CardStyle {
  key: string;
  /** 分享页上给用户看的板式名 */
  name: string;
  /** 整幅背景,代码画 */
  paintBg(ctx: Ctx2D): void;
  /** 中轴白卡:填充色 / 圆角 / 投影 / 描边,四种参数就能做出三种性格 */
  card: {
    fill: string;
    radius: number;
    shadow?: { color: string; blur: number; dy: number };
    border?: { color: string; width: number };
  };
  /** 眉题字色(画在背景上,不进卡) */
  eyebrow: string;
  /** 坚持天数徽章 */
  pill: { fill: string; text: string };
  /** 页脚:bandFill 有值就整条铺色,没有就画一道 hairline */
  footer: {
    bandFill?: string;
    rule?: string;
    ink: string;
    sub: string;
    caption: string;
    /** 品牌小标:底色 + 「轻」的字色 */
    chip: { fill: string; mark: string };
  };
}

/** 竖向渐变;canvas 不给 createLinearGradient(单测假 ctx)就退回最后一档纯色 */
function vGrad(ctx: Ctx2D, y0: number, y1: number, stops: Array<[number, string]>): unknown {
  if (!ctx.createLinearGradient) return stops[stops.length - 1][1];
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [off, color] of stops) g.addColorStop(off, color);
  return g;
}

export const CARD_STYLES: Record<'forest' | 'paper' | 'clean', CardStyle> = {
  forest: {
    key: 'forest',
    name: '墨绿刊',
    paintBg(ctx) {
      ctx.fillStyle = vGrad(ctx, 0, DAILY_H, [[0, '#2f8c6d'], [0.5, '#1e6e54'], [1, '#0e4636']]);
      ctx.fillRect(0, 0, DAILY_W, DAILY_H);
      dot(ctx, 665, -50, 300, 'rgba(247,244,235,0.06)');
      dot(ctx, 30, 860, 260, 'rgba(247,244,235,0.05)');
      dot(ctx, 706, 1044, 84, 'rgba(247,244,235,0.05)');
    },
    card: { fill: PAPER, radius: 36, shadow: { color: 'rgba(6,32,24,0.32)', blur: 30, dy: 14 } },
    eyebrow: 'rgba(247,244,235,0.92)',
    pill: { fill: '#eabf63', text: '#3d2b06' },
    footer: {
      bandFill: '#0e4636',
      ink: PAPER,
      sub: 'rgba(255,255,254,0.72)',
      caption: 'rgba(255,255,254,0.78)',
      chip: { fill: PAPER, mark: INK }
    }
  },
  paper: {
    key: 'paper',
    name: '暖纸手账',
    paintBg(ctx) {
      ctx.fillStyle = '#f7f4eb';
      ctx.fillRect(0, 0, DAILY_W, DAILY_H);
      dot(ctx, 745, 130, 330, 'rgba(23,107,85,0.07)');
      dot(ctx, -40, 730, 260, 'rgba(23,107,85,0.06)');
      dot(ctx, 700, 1230, 200, 'rgba(200,154,60,0.06)');
    },
    card: { fill: PAPER, radius: 36, shadow: { color: 'rgba(15,74,58,0.18)', blur: 26, dy: 12 } },
    eyebrow: EYEBROW,
    pill: { fill: INK_STRONG, text: PAPER },
    footer: {
      rule: 'rgba(15,74,58,0.14)',
      ink: INK,
      sub: '#5c6f64',
      caption: '#6b7d72',
      chip: { fill: INK_STRONG, mark: PAPER }
    }
  },
  clean: {
    key: 'clean',
    name: '极简白',
    paintBg(ctx) {
      ctx.fillStyle = '#fffefa';
      ctx.fillRect(0, 0, DAILY_W, DAILY_H);
      ctx.strokeStyle = 'rgba(15,74,58,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(26, 26);
      ctx.lineTo(DAILY_W - 26, 26);
      ctx.lineTo(DAILY_W - 26, DAILY_H - 26);
      ctx.lineTo(26, DAILY_H - 26);
      ctx.closePath();
      ctx.stroke();
    },
    card: { fill: '#fffefa', radius: 8, border: { color: 'rgba(15,74,58,0.10)', width: 2 } },
    eyebrow: '#8a958f',
    pill: { fill: INK_STRONG, text: PAPER },
    footer: {
      rule: 'rgba(15,74,58,0.16)',
      ink: INK,
      sub: '#5c6f64',
      caption: '#6b7d72',
      chip: { fill: INK_STRONG, mark: PAPER }
    }
  }
};

export const CARD_STYLE_KEYS = Object.keys(CARD_STYLES) as Array<keyof typeof CARD_STYLES>;

/* ============ 纯排版计算(可单测) ============ */

/** 按最大宽折行;超过 maxLines 截断加省略号。返回行数组(空文本返回 ['']) */
export function wrapLines(ctx: Ctx2D, text: string, maxWidth: number, maxLines: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > 0 && lines.length < maxLines) {
    let cut = rest.length;
    while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
    if (cut <= 1) cut = 1;
    const isLast = rest.length - cut <= 0 || lines.length === maxLines - 1;
    // 最后一行放不下整段时收个尾:再让出省略号的宽度
    if (isLast && rest.length - cut > 0) {
      while (cut > 1 && ctx.measureText(`${rest.slice(0, cut)}…`).width > maxWidth) cut -= 1;
      lines.push(`${rest.slice(0, cut)}…`);
      return lines;
    }
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return lines.length ? lines : [''];
}

/** 大字标题的字号:56 起步,超宽就缩,44 是下限(再小「及格了」就没气势了) */
export function fitHeadlineSize(ctx: Ctx2D, text: string, maxWidth: number): number {
  for (const size of [56, 52, 48, 44]) {
    ctx.font = `700 ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return 44;
}

/** 判定文案里的半角逗号是给日志看的,上卡换成全角才像个句子 */
const zh = (s: string): string => s.replace(/,/g, '，');

/** 「…✓」结尾的标题把勾剥下来,由画的那枚徽章接班 */
function splitTick(headline: string): { text: string; tick: boolean } {
  if (/\s*✓$/.test(headline)) return { text: headline.replace(/\s*✓$/, ''), tick: true };
  return { text: headline, tick: false };
}

/* ============ 绘制 ============ */

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
  ctx.fill();
}

/** 圆点、圆章这类实心圆 */
function dot(ctx: Ctx2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** 短刻度线:标题下、金句下的那道主色 accent */
function tick(ctx: Ctx2D, cx: number, y: number, halfW: number, color: string, width = 5): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - halfW, y);
  ctx.lineTo(cx + halfW, y);
  ctx.stroke();
  ctx.restore();
}

/** 顶上那行小眉题:模板名 + 日期 */
function drawEyebrow(ctx: Ctx2D, kind: string, dateLabel: string, style: CardStyle): void {
  ctx.textAlign = 'center';
  ctx.fillStyle = style.eyebrow;
  ctx.font = '400 28px sans-serif';
  ctx.fillText(`${kind} · ${dateLabel}`, DAILY_W / 2, 106);
}

/** 中轴白卡:按板式上投影/描边 */
function drawCard(ctx: Ctx2D, style: CardStyle): void {
  const { fill, radius, shadow, border } = style.card;
  if (shadow) {
    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetY = shadow.dy;
  }
  ctx.fillStyle = fill;
  roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, radius);
  if (shadow) ctx.restore();
  if (border) {
    ctx.save();
    ctx.strokeStyle = border.color;
    ctx.lineWidth = border.width;
    ctx.beginPath();
    ctx.moveTo(CARD_X + radius, CARD_Y);
    ctx.lineTo(CARD_X + CARD_W - radius, CARD_Y);
    ctx.arc(CARD_X + CARD_W - radius, CARD_Y + radius, radius, -Math.PI / 2, 0);
    ctx.lineTo(CARD_X + CARD_W, CARD_Y + CARD_H - radius);
    ctx.arc(CARD_X + CARD_W - radius, CARD_Y + CARD_H - radius, radius, 0, Math.PI / 2);
    ctx.lineTo(CARD_X + radius, CARD_Y + CARD_H);
    ctx.arc(CARD_X + radius, CARD_Y + CARD_H - radius, radius, Math.PI / 2, Math.PI);
    ctx.lineTo(CARD_X, CARD_Y + radius);
    ctx.arc(CARD_X + radius, CARD_Y + radius, radius, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

/** 坚持天数徽章(0 = 接口都没成,别硬画「第 0 天」) */
function drawStreak(ctx: Ctx2D, recordDays: number, style: CardStyle): void {
  if (recordDays <= 0) return;
  const text = `已坚持记录 ${recordDays} 天`;
  ctx.font = '600 28px sans-serif';
  const w = ctx.measureText(text).width + 112;
  const x = (DAILY_W - w) / 2;
  const y = 976;
  ctx.save();
  ctx.shadowColor = 'rgba(15,74,58,0.26)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = style.pill.fill;
  roundRect(ctx, x, y, w, 62, 31);
  ctx.restore();
  ctx.fillStyle = style.pill.text;
  ctx.textAlign = 'center';
  ctx.fillText(text, DAILY_W / 2, y + 41);
}

/**
 * 底部品牌条:墨绿刊整条铺色(和渐变底无缝);另两版走 hairline 分隔。
 * 左边品牌(小标方块 + 字),右边小程序码白卡(没码画绿圆章,别让角落空着)。
 */
function drawFooter(ctx: Ctx2D, imgs: CardImages, style: CardStyle): void {
  const f = style.footer;
  if (f.bandFill) {
    ctx.fillStyle = f.bandFill;
    ctx.fillRect(0, BAND_Y, DAILY_W, DAILY_H - BAND_Y);
  } else if (f.rule) {
    ctx.fillStyle = f.rule;
    ctx.fillRect(56, BAND_Y + 18, DAILY_W - 112, 2);
  }

  // 品牌小标:方块 + 「轻」
  ctx.fillStyle = f.chip.fill;
  roundRect(ctx, 56, 1189, 84, 84, 22);
  ctx.fillStyle = f.chip.mark;
  ctx.textAlign = 'center';
  ctx.font = '700 48px sans-serif';
  ctx.fillText('轻', 98, 1247);
  ctx.textAlign = 'left';
  ctx.fillStyle = f.ink;
  ctx.font = '700 40px sans-serif';
  ctx.fillText('轻身记', 162, 1218);
  ctx.fillStyle = f.sub;
  ctx.font = '400 22px sans-serif';
  ctx.fillText('记录，是改变的开始', 163, 1262);

  // 小程序码:白卡 150,码 124;没码画绿圆章兜底
  ctx.textAlign = 'right';
  ctx.fillStyle = f.caption;
  ctx.font = '400 20px sans-serif';
  ctx.fillText('扫码进小程序', 518, 1240);
  ctx.fillStyle = PAPER;
  roundRect(ctx, 542, 1156, 150, 150, 24);
  if (imgs.qr) {
    ctx.drawImage(imgs.qr, 555, 1169, 124, 124);
  } else {
    dot(ctx, 617, 1231, 46, '#176b55');
    ctx.fillStyle = PAPER;
    ctx.textAlign = 'center';
    ctx.font = '700 42px sans-serif';
    ctx.fillText('轻', 617, 1246);
  }
}

/** 模板一:今日成绩单 */
export function drawReport(ctx: Ctx2D, data: ReportCardData, imgs: CardImages, style: CardStyle = CARD_STYLES.forest): void {
  ctx.save();
  style.paintBg(ctx);
  drawEyebrow(ctx, '今日成绩单', data.dateLabel, style);
  drawCard(ctx, style);

  // 大字标题(✓ 换成画的徽章)
  const { text: head, tick: hasTick } = splitTick(data.verdict.headline);
  const hs = fitHeadlineSize(ctx, head, TEXT_W);
  const text = zh(head);
  ctx.font = `700 ${hs}px sans-serif`;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.fillText(text, DAILY_W / 2, 258);
  if (hasTick) {
    const w = ctx.measureText(text).width;
    const bx = DAILY_W / 2 + w / 2 + 30;
    const by = 239;
    dot(ctx, bx, by, 19, STATUS_COLOR.ok);
    ctx.save();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 6.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 8.5, by + 0.5);
    ctx.lineTo(bx - 2, by + 7.5);
    ctx.lineTo(bx + 9.5, by - 7.5);
    ctx.stroke();
    ctx.restore();
  }
  // 标题下的主色短刻度:颜色跟着「最大的那个问题」走
  const worst = data.verdict.rows.find((r) => r.status === 'bad' || r.status === 'warn')?.status;
  tick(ctx, DAILY_W / 2, 292, 30, worst ? STATUS_COLOR[worst] : data.verdict.empty ? '#9db3a6' : STATUS_COLOR.ok);

  // 四行证据:状态圆点 + 标签左 / 数值右 + 进度条(没数据的行画刻意留白细线)
  const rows = data.verdict.rows;
  rows.slice(0, 4).forEach((row, i) => {
    const y = 360 + i * 104;
    dot(ctx, 114, y - 9, 6.5, STATUS_COLOR[row.status] ?? STATUS_COLOR.none);
    ctx.textAlign = 'left';
    ctx.fillStyle = SUB;
    ctx.font = '400 26px sans-serif';
    ctx.fillText(row.label, PAD_L, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = INK_STRONG;
    ctx.font = '600 32px sans-serif';
    ctx.fillText(row.main, PAD_R, y + 2);
    if (row.pct != null) {
      ctx.fillStyle = BAR_TRACK;
      roundRect(ctx, PAD_L, y + 16, PAD_R - PAD_L, 10, 5);
      ctx.fillStyle = STATUS_COLOR[row.status] ?? STATUS_COLOR.ok;
      roundRect(ctx, PAD_L, y + 16, Math.max(16, ((PAD_R - PAD_L) * row.pct) / 100), 10, 5);
    } else {
      ctx.fillStyle = BAR_FLAT;
      ctx.fillRect(PAD_L, y + 19, PAD_R - PAD_L, 4);
    }
  });

  // 人话点评:浅绿衬底 + 左侧主色竖条,居中放在余下的空间里
  const commentLines = wrapLines(ctx, zh(data.verdict.comment), 484, 2);
  const bandH = 40 + commentLines.length * 42;
  const bandY = 698 + Math.round((194 - bandH) / 2);
  ctx.fillStyle = 'rgba(23,107,85,0.07)';
  roundRect(ctx, 99, bandY, 552, bandH, 18);
  ctx.fillStyle = '#176b55';
  roundRect(ctx, 99, bandY + 18, 6, bandH - 36, 3);
  ctx.fillStyle = COMMENT;
  ctx.textAlign = 'left';
  ctx.font = '400 26px sans-serif';
  const cy = bandY + bandH / 2 + 9 - (commentLines.length - 1) * 21;
  commentLines.forEach((l, i) => ctx.fillText(l, 143, cy + i * 42));

  drawStreak(ctx, data.recordDays, style);
  drawFooter(ctx, imgs, style);
  ctx.restore();
}

/** 模板二:金句 */
export function drawQuote(ctx: Ctx2D, data: QuoteCardData, imgs: CardImages, style: CardStyle = CARD_STYLES.forest): void {
  ctx.save();
  style.paintBg(ctx);
  drawEyebrow(ctx, '今日一句', data.dateLabel, style);
  drawCard(ctx, style);

  // 一对大引号当装饰:左上「右下」,把金句的对角撑住,卡不至于两头空
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(23,107,85,0.16)';
  ctx.font = '700 130px sans-serif';
  ctx.fillText('「', 88, 300);
  ctx.textAlign = 'right';
  ctx.fillText('」', 662, 892);

  // 金句本体:最多三行,和副句、刻度线作为一整块在卡内心区(230–870)光学居中
  ctx.font = '700 52px sans-serif';
  const lines = wrapLines(ctx, zh(data.quote.text), TEXT_W, 3);
  const blockH = lines.length * 84 + 52;
  const top = 230 + Math.round((640 - blockH) / 2);
  const firstY = top + 40;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, DAILY_W / 2, firstY + i * 84));

  const tickY = firstY + (lines.length - 1) * 84 + 40;

  const tickY = firstY + (lines.length - 1) * 74 + 40;
  tick(ctx, DAILY_W / 2, tickY, 26, '#176b55', 4);
  ctx.fillStyle = SUB;
  ctx.font = '400 28px sans-serif';
  ctx.fillText(zh(data.quote.sub), DAILY_W / 2, tickY + 42);

  drawStreak(ctx, data.recordDays, style);
  drawFooter(ctx, imgs, style);
  ctx.restore();
}
