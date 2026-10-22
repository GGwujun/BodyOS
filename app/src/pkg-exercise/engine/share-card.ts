/**
 * 训练分享卡 —— 把一次训练画成一张能发出去的图。
 *
 * 为什么要它:练完那一刻是分享欲最强的时候,而小程序默认只能分享一个链接卡片
 * (标题 + 缩略图),内容全靠别人点进来。一张图能直接说明「我今天练了什么、练了多少」。
 *
 * 画布按 600×900 的**逻辑尺寸**排,真实像素乘 dpr —— 这样在 2x/3x 屏上导出的图一样清晰。
 * 拆分:纯排版计算(dateText/topEntries/setSummary)与绘制(drawCard)分开,
 * 前者能单测,后者只负责把算好的数字摆到画布上。
 */

import { fmtSpan } from '../../utils/duration';
import type { PrEntry } from './history';
import { loadText } from './load';
import { isSided, sideRepsText } from './sided';
import { holdText } from './timed';
import { countsForProgress, didSet, type WorkoutLog } from './types';

export interface CardEntry {
  /** 动作 id —— 用来定重量口径(附加重量要带 +、助力要说「助力」,见 engine/load.ts) */
  exerciseId?: string;
  nameZh: string;
  sets: number;
  /** 最重的一组;自重为 null */
  topWeightKg: number | null;
  /** 最重那组的次数;单侧动作是**两侧合计**(显示时折成每侧) */
  topReps: number;
  /**
   * 计时型动作**最长那组**的秒数(见 engine/timed.ts);次数型没有这个字段。
   * 有它就不再走 `× 次数` 那一套 —— 卡上写「3 组 · 1 分 30 秒」。
   */
  topSec?: number;
  /** 单侧动作(见 engine/sided.ts) */
  sided?: boolean;
}

export interface CardData {
  /** YYYY-MM-DD */
  date: string;
  dayTitle: string;
  durationSec: number;
  totalSets: number;
  totalVolumeKg: number;
  /** 这次刷新/接近的个人纪录文案(可空) */
  prText?: string | null;
  entries: CardEntry[];
}

export const CARD_W = 600;
export const CARD_H = 900;
/** 卡上最多列几个动作 —— 多了字就小到看不清了 */
export const CARD_MAX_ENTRIES = 6;

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const C = {
  green: '#176b55',
  greenDark: '#11503f',
  ink: '#172b29',
  sub: '#66756e',
  faint: '#e8e4d9',
  white: '#fffefa'
};

/* ============ 纯排版计算(可单测) ============ */

/** 「2026-10-15」→ 「10月15日 · 周三」 */
export function dateText(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return date;
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK[d.getDay()]}`;
}

/** 「12,480」—— 容量数字大,加千分位才读得出来 */
export function withComma(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 一组动作在卡上怎么写:「3 组 · 60kg × 8」/ 自重:「3 组 · 自重 × 12」。
 * 单侧动作说「每侧」—— 卡上写「20kg × 24」对面的人会以为你一口气举了 24 个。
 * 负重自重带 `+` —— 卡上写「20kg × 8」对面的人会以为你总共只举了 20kg。
 */
export function setSummary(e: CardEntry): string {
  const w = e.topWeightKg != null && e.topWeightKg > 0
    ? loadText(e.exerciseId ?? '', e.topWeightKg)
    : '自重';
  // 计时型:卡上写「3 组 · 自重 1 分 30 秒」。和 workout-text 一样不写 `×` ——
  // 一次支撑不是乘出来的,记号不同,读的人就知道这组不是按次数记的。
  if (e.topSec != null && e.topSec > 0) return `${e.sets} 组 · ${w} ${holdText(e.topSec)}`;
  const reps = e.sided ? `每侧 ${sideRepsText(e.topReps)}` : String(e.topReps);
  return `${e.sets} 组 · ${w} × ${reps}`;
}

/**
 * 卡上列哪几个动作(只列前 6 个,多了字就小到看不清)。
 * 先看**练了几组** —— 组数是"这个动作在这次训练里占多大分量"最稳的代理;
 * 组数一样再比分量:有配重按 重量 × 次数,徒手按 次数。计时型没有「次数」可乘,
 * 就按时长比 —— 不给它另开一档,否则一次 3 组平板支撑会在排序里沉到底部,
 * 而那次训练可能就它最费劲。
 * 这样 4 组引体不会输给 1 组 10kg 的器械 —— 徒手动作不该被杠铃动作全挤掉。
 */
export function topEntries(entries: CardEntry[], max = CARD_MAX_ENTRIES): CardEntry[] {
  const rank = (e: CardEntry): [number, number] => [
    Math.max(1, e.sets),
    (e.topWeightKg != null && e.topWeightKg > 0 ? e.topWeightKg : 1)
      * Math.max(1, (e.topSec ?? 0) > 0 ? (e.topSec as number) : e.topReps)
  ];
  return [...entries]
    .sort((a, b) => {
      const [sa, la] = rank(a);
      const [sb, lb] = rank(b);
      return sb - sa || lb - la;
    })
    .slice(0, Math.max(0, max));
}

/** 训练容量的一句人话(卡上副标题位置有限) */
export function volumeText(kg: number): string {
  if (!Number.isFinite(kg) || kg <= 0) return '0 kg';
  if (kg >= 10000) return `${(kg / 1000).toFixed(1)} 吨`;
  return `${withComma(kg)} kg`;
}

/**
 * 训练日志 + 个人纪录 → 卡上的数据。
 * 只统计**真做了的组**(`didSet`:次数 > 0 **或**秒数 > 0)—— 判据不能只写 `reps > 0`,
 * 那会把每一个计时组当成没做,一个核心日会直接空着。跳过、未完成的组不该出现在分享图上。
 * 次数型取的是**最重那组**,计时型取的是**最长那组** —— 分享卡说的是这次表现最好的一组。
 */
export function cardDataOf(log: WorkoutLog, prs: PrEntry[] = []): CardData {
  const entries: CardEntry[] = [];
  for (const e of log.entries) {
    const done = e.sets.filter(didSet);
    if (!done.length) continue;
    const best = done.reduce((a, b) => ((b.weightKg ?? 0) > (a.weightKg ?? 0) ? b : a));
    // 计时型:没配重时「最重」这一维全是 0,reduce 会退回第一组 —— 那不一定是最长的那组,
    // 所以另取一次最大值(有配重的搬运类两个维度都要:重量挑出的那组也未必撑得最久,
    // 但重量是它的主变量,和次数型的读法一致,就不在这里改口径了)。
    const holdTop = done.reduce((a, b) => Math.max(a, b.sec ?? 0), 0);
    entries.push({
      exerciseId: e.exerciseId,
      nameZh: e.nameZh,
      sets: done.length,
      topWeightKg: best.weightKg,
      topReps: best.reps,
      ...(holdTop > 0 ? { topSec: holdTop } : {}),
      sided: isSided(e.exerciseId)
    });
  }
  return {
    date: log.date,
    dayTitle: log.dayTitle,
    durationSec: log.durationSec,
    totalSets: log.totalSets || entries.reduce((n, e) => n + e.sets, 0),
    totalVolumeKg: log.totalVolumeKg,
    prText: prTextOf(log, prs),
    entries
  };
}

/**
 * 这次训练有没有刷新纪录。严格讲「同一天练了两次」会分不清是哪次刷的 ——
 * 那就都说成「今天刷新的」,比说错成「这次」要诚实。
 * 标了「这次不算进步」的那次也不宣称刷新纪录(那天的纪录若真有,是同一天另一次刷的)。
 */
export function prTextOf(log: WorkoutLog, prs: PrEntry[]): string | null {
  if (!prs.length) return null;
  const ids = new Set(log.entries.map((e) => e.exerciseId));
  // 挑「有成绩」的:次数型看重量(topKg),计时型看保持时长(bestHoldSec)。
  // 只写 `topKg > 0` 的话,计时型动作那三个维度全是 0 —— 一个纪录都宣不出来。
  const hit = prs.filter((p) => ids.has(p.exerciseId) && (p.topKg > 0 || p.bestHoldSec > 0)
    && countsForProgress(log) && p.date === log.date);
  if (!hit.length) return null;
  if (hit.length > 2) return `新纪录 · ${hit.length} 个动作刷新了最好成绩`;
  return `新纪录 · ${hit.map((p) => {
    if (p.topKg <= 0 && p.bestHoldSec > 0) return `${p.nameZh} 保持 ${holdText(p.bestHoldSec)}`;
    const reps = isSided(p.exerciseId) ? `每侧 ${sideRepsText(p.topReps)}` : String(p.topReps);
    return `${p.nameZh} ${loadText(p.exerciseId, p.topKg)} × ${reps}`;
  }).join(' / ')}`;
}

/* ============ 绘制 ============ */

/** 渐变只需这一个方法,不必依赖小程序的 CanvasGradient 类型 */
export interface GradLike { addColorStop(offset: number, color: string): void }

/** 只需要用到这几个方法 —— 方便单测传假 ctx(fillStyle 用 unknown:真机上它还能是 CanvasPattern) */
export interface Ctx2D {
  fillStyle: unknown;
  font: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  closePath(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradLike;
}

/** 长了就截断加省略号(卡上宁可少几个字,也不要挤出去) */
export function fitText(ctx: Ctx2D, text: string, maxWidth: number): string {
  if (!text) return '';
  try {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  } catch {
    // 拿不到测量就不要冒险截断(某些环境 measureText 会抛)
    return text;
  }
}

/**
 * 把一次训练画到画布上。
 * **坐标全是 CARD_W×CARD_H 的逻辑坐标** —— 真机上请先 `ctx.scale(dpr, dpr)`
 * (和 LineChart 同一套做法),这里不重复处理缩放。
 */
export function drawCard(ctx: Ctx2D, data: CardData): void {
  const W = CARD_W;
  const H = CARD_H;
  const PAD = 44;

  ctx.save();

  // 底
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, W, H);

  // 顶部绿带
  let grad: string | GradLike = C.green;
  try {
    grad = ctx.createLinearGradient(0, 0, W, 300);
    grad.addColorStop(0, C.green);
    grad.addColorStop(1, C.greenDark);
  } catch { /* 没有渐变就用纯色 */ }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 300);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 顶部文案
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 28px sans-serif';
  ctx.fillText('训练完成', PAD, 84);

  ctx.fillStyle = C.white;
  ctx.font = '700 62px sans-serif';
  ctx.fillText(dateText(data.date), PAD, 168);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '400 30px sans-serif';
  ctx.fillText(fitText(ctx, data.dayTitle || '训练', W - PAD * 2), PAD, 226);

  // 三个大数字
  const stats: [string, string][] = [
    [`${data.totalSets}`, '组'],
    [volumeText(data.totalVolumeKg), '总容量'],
    [fmtSpan(data.durationSec), '用时']
  ];
  const colW = (W - PAD * 2) / 3;
  stats.forEach(([value, label], i) => {
    const x = PAD + colW * i;
    ctx.fillStyle = C.ink;
    ctx.font = '700 40px sans-serif';
    ctx.fillText(fitText(ctx, value, colW - 12), x, 386);
    ctx.fillStyle = C.sub;
    ctx.font = '400 24px sans-serif';
    ctx.fillText(label, x, 424);
  });

  // 分割线
  ctx.fillStyle = C.faint;
  ctx.fillRect(PAD, 470, W - PAD * 2, 2);

  // 动作清单
  ctx.fillStyle = C.ink;
  ctx.font = '600 28px sans-serif';
  ctx.fillText('今天练了', PAD, 528);

  const rows = topEntries(data.entries);
  ctx.font = '400 26px sans-serif';
  rows.forEach((e, i) => {
    const y = 582 + i * 44;
    ctx.fillStyle = C.green;
    ctx.beginPath();
    ctx.arc(PAD + 6, y - 9, 5, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = C.ink;
    ctx.font = '400 26px sans-serif';
    const name = fitText(ctx, e.nameZh, W - PAD * 2 - 240);
    ctx.fillText(name, PAD + 24, y);

    ctx.fillStyle = C.sub;
    ctx.font = '400 24px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(setSummary(e), W - PAD, y);
    ctx.textAlign = 'left';
  });
  if (!rows.length) {
    ctx.fillStyle = C.sub;
    ctx.font = '400 26px sans-serif';
    ctx.fillText('这次没有记录到动作明细', PAD, 582);
  }

  // 个人纪录
  if (data.prText) {
    const y = 606 + rows.length * 44 + 14;
    ctx.fillStyle = '#edf2ea';
    ctx.fillRect(PAD, y - 30, W - PAD * 2, 60);
    ctx.fillStyle = C.greenDark;
    ctx.font = '600 26px sans-serif';
    ctx.fillText(fitText(ctx, data.prText, W - PAD * 2 - 32), PAD + 16, y + 8);
  }

  // 页脚
  ctx.fillStyle = C.faint;
  ctx.fillRect(PAD, H - 84, W - PAD * 2, 2);
  ctx.fillStyle = C.sub;
  ctx.font = '400 24px sans-serif';
  ctx.fillText('BodyOS · 训练日志', PAD, H - 40);

  ctx.restore();
}
