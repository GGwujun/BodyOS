import { addDays, toDate, todayStr } from '../lib/date';

/** 平台期判定结果。趋势页体重卡据此给一句提示;周报(订阅消息)以后也用这一份口径 */
export interface PlateauInfo {
  /** 窗口里最早到最晚一次称重隔了多少天 */
  days: number;
  /** 窗口内称重次数 */
  records: number;
  /** 线性回归估出的整个窗口总变化(kg,带符号) */
  changeKg: number;
}

/** 判定窗口:三周。再短会把正常的日间波动认成平台 */
const WINDOW_DAYS = 21;
/** 窗口内至少要有几次称重 —— 少于这个数说明称得太稀,不敢下结论 */
const MIN_RECORDS = 4;
/** 首末两次称重至少隔多少天。四次都挤在三天里,说明不了三周的事 */
const MIN_SPAN_DAYS = 14;
/** 最后一次称重距今天超过这个数就不判:人没在称,不能说他「卡住了」 */
const MAX_STALE_DAYS = 7;
/** 整窗变化在这个幅度内算「没动」。0.5kg 也正好盖过普通体重秤的日间波动 */
const STALL_KG = 0.5;

function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/**
 * 体重平台期检测(纯规则,无任何模型参与,文案也不许出现相关字样)。
 * 判定:减脂/增肌目标下,最近三周称得足够勤(≥4 次、跨度 ≥14 天、最近一次在 7 天内),
 * 且线性回归估出的整窗变化不足 ±0.5kg —— 提示「平台期」,把「为什么不掉秤」
 * 从用户的自我怀疑变成一条可解释的规则。
 * 维持目标不变就是达成,耐力目标不看体重:这两种直接返回 null。
 */
export function detectPlateau(
  weights: { date: string; weightKg: number }[],
  goalType: string | null | undefined,
  today: string = todayStr()
): PlateauInfo | null {
  if (goalType !== 'fat_loss' && goalType !== 'muscle_gain') return null;

  const windowStart = addDays(today, -(WINDOW_DAYS - 1));
  const inWindow = weights.filter((w) => w.date >= windowStart && w.date <= today);
  if (inWindow.length < MIN_RECORDS) return null;
  if (daysBetween(inWindow[inWindow.length - 1].date, today) > MAX_STALE_DAYS) return null;

  const firstDate = inWindow[0].date;
  const spanDays = daysBetween(firstDate, inWindow[inWindow.length - 1].date);
  if (spanDays < MIN_SPAN_DAYS) return null;

  // 最小二乘:斜率 × 跨度 = 整窗变化量。比首尾两点相减抗单日波动(吃了顿火锅的第二天不算趋势)
  const xs = inWindow.map((w) => daysBetween(firstDate, w.date));
  const ys = inWindow.map((w) => w.weightKg);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const changeKg = Math.round(slope * spanDays * 10) / 10;

  return Math.abs(changeKg) < STALL_KG ? { days: spanDays, records: n, changeKg } : null;
}
