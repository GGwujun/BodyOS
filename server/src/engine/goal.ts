import { clamp } from './constants';

export interface WeightPoint {
  date: string; // YYYY-MM-DD
  weightKg: number;
}

/** 目标热量区间(±5%) */
export function targetCalorieRange(targetCalories: number): [number, number] {
  return [targetCalories * 0.95, targetCalories * 1.05];
}

/**
 * 体重趋势:对最近 N 个点做线性回归,返回每日变化斜率(kg/天)。
 * 数据不足返回 0。
 */
export function weightTrend(points: WeightPoint[]): number {
  if (points.length < 2) return 0;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const xs = sorted.map((_, i) => i);
  const ys = sorted.map((p) => p.weightKg);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * 目标进度(0-1)。
 * 减脂:(起始 - 当前) / 目标变化量;增肌反之。
 */
export function goalProgress(params: {
  type: string;
  startValue: number;
  currentValue: number;
  targetChange: number;
}): number {
  const { type, startValue, currentValue, targetChange } = params;
  if (targetChange === 0) return 0;
  let progress: number;
  if (type === 'muscle_gain') {
    progress = (currentValue - startValue) / targetChange;
  } else {
    progress = (startValue - currentValue) / targetChange;
  }
  return clamp(progress, 0, 1);
}

/**
 * 目标评分(0-100):进度 + 近期趋势一致性。
 */
export function goalScore(params: {
  progress: number; // 0-1
  trend: number; // kg/天,正向为符合目标方向
  type: string;
  isActive: boolean;
}): number {
  if (!params.isActive) return 70;
  const progressPart = params.progress * 70;
  // 趋势一致性:减脂期望 trend<0,增肌期望 trend>0
  const expectsNegative = params.type !== 'muscle_gain';
  const trendOk = expectsNegative ? params.trend <= 0 : params.trend >= 0;
  const trendPart = trendOk ? Math.min(30, Math.abs(params.trend) * 30 * 7 + 15) : Math.max(0, 15 - Math.abs(params.trend) * 100);
  return Math.round(clamp(progressPart + trendPart, 0, 100));
}
