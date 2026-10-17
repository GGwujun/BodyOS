/**
 * 体重按周汇总 —— 这个页面上唯一值得盯的数字。
 *
 * 为什么不是每天的点:**今天早上和昨天晚上,体重差得比一个月的变化还多**。
 * 水肿、盐、上一顿饭、称重时间、有没有排便,任何一样都能让单日数字上下 1-2kg,
 * 而真实的变化在减脂期一周也就 0.3-0.7kg。于是用户每天看到一个乱跳的数字,
 * 得出「我是不是没效果」或者「昨天那顿火锅胖了两斤」——两个结论都是假的。
 * 周均值把水分抹平,剩下的是趋势;这也是体重页那句提示(「取每周平均值对比」)一直
 * 在说、但页面上没做过的事。
 *
 * 口径:
 *  · 一周从**周一**开始(与热力图同一口径,见 utils/date.ts);
 *  · `delta` 比的是**上一个有记录的周**,不是上一周 —— 中间漏称的周不是「0kg」,
 *    跳过它去跟更早的周比,同时把比的是哪一周(`prevStart`)说出来,不让用户自己猜;
 *  · 缺日期、缺体重、体重 ≤ 0 的记录直接丢掉,不参与平均(当成 0 会把均值拉垮);
 *  · 本周没称完也算进来(否则用户刚称的几次数不出来),UI 自己标「本周进行中」。
 */
import { addDays, dayDiff, mondayOf } from './date';

/** 能被汇总的一条称重(体重页的 WeightRecord 结构上就满足它) */
export interface WeighIn {
  date: string;      // YYYY-MM-DD
  weightKg: number;
}

export interface WeightWeek<T extends WeighIn = WeighIn> {
  /** 本周周一(YYYY-MM-DD) */
  start: string;
  /** 本周周日(YYYY-MM-DD) */
  end: string;
  /** 这一周的均值(两位小数) */
  avg: number;
  /** 这一周称了几次 */
  n: number;
  /** 比上一个有记录的周高/低多少(公斤,两位小数);第一周为 null */
  delta: number | null;
  /** `delta` 比的是哪一周的周一;第一周为 null */
  prevStart: string | null;
  /** 这一周的称重,新的在前 */
  entries: T[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 按周汇总,新的周在前。
 * 输入顺序无所谓(调用方按日期升序拿到的就用),同一周里的多次称重都计入均值。
 */
export function weeklyWeights<T extends WeighIn>(records: T[] | null | undefined): WeightWeek<T>[] {
  const byWeek = new Map<string, T[]>();
  for (const r of records ?? []) {
    if (!r?.date || !(r.weightKg > 0)) continue;
    const start = mondayOf(r.date);
    const bucket = byWeek.get(start);
    if (bucket) bucket.push(r);
    else byWeek.set(start, [r]);
  }

  const weeks: WeightWeek<T>[] = [...byWeek.keys()]
    .sort()
    .map((start) => {
      const entries = [...byWeek.get(start)!].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      const avg = round2(entries.reduce((sum, e) => sum + e.weightKg, 0) / entries.length);
      return { start, end: addDays(start, 6), avg, n: entries.length, delta: null, prevStart: null, entries };
    });

  weeks.forEach((w, i) => {
    const prev = weeks[i - 1];
    if (!prev) return;
    w.delta = round2(w.avg - prev.avg);
    w.prevStart = prev.start;
  });

  return weeks.reverse();
}

/** 差多少周(给「上次记录是 3 周前」这种话用) */
export function weeksApart(fromStart: string, toStart: string): number {
  return Math.round(dayDiff(fromStart, toStart) / 7);
}

/** 变化量 < 0.1kg 当没变 —— 周均值上 0.1kg 已经是水分级别了 */
export const WEEK_DELTA_AT = 0.1;

/**
 * 周间差值念出来:`{ text: '+0.4 kg', dir: 1 }` / `'-0.6 kg'` / `'没变'`。
 * 减脂/增肌的目标是「每周 0.5kg 左右」,所以 0.1 的阈值不能再大 ——
 * 把 -0.3kg 这种正儿八经的一周成果念成「没变」,才是真的误导。
 *
 * `dir` 和文案一起给:页面上「绿还是灰」要按同一个阈值判,分开算迟早会
 * 出现「文字说没变、颜色却是绿的」。
 */
export function weekDelta(delta: number | null): { text: string; dir: -1 | 0 | 1 } {
  if (delta == null) return { text: '—', dir: 0 };
  const d = round2(delta);
  if (Math.abs(d) < WEEK_DELTA_AT) return { text: '没变', dir: 0 };
  return { text: `${d > 0 ? '+' : ''}${d} kg`, dir: d > 0 ? 1 : -1 };
}
