import { request } from './request';

export interface TrendDay {
  date: string;
  bodyScore: number | null;
  energyScore: number | null;
  nutritionScore: number | null;
  activityScore: number | null;
  recoveryScore: number | null;
  goalScore: number | null;
  intakeCalories: number;
  burnCalories: number | null;
  netCalories: number | null;
  steps: number;
  /** 当天三大营养素合计(服务端已按天汇总好,客户端只负责加与显示) */
  nutrition: MacroTotals;
}

/** 每日宏量合计。字段口径见 utils/nutrition.ts 的文件头 */
export interface MacroTotals {
  proteinG: number;
  carbG: number;
  fatG: number;
}

/** 引擎算出来的每日宏量目标(资料不全时为 null —— 不给按默认体重猜的目标) */
export interface MacroTarget {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export interface TrendResult {
  range: number;
  summaries: TrendDay[];
  weights: WeightPoint[];
  macroTarget: MacroTarget | null;
  /** 进行中的目标 —— 趋势页按它的方向判断「掉秤」是好事还是坏事 */
  goal: { type: 'fat_loss' | 'muscle_gain' | 'maintain' | 'endurance'; unit: string; targetValue: number } | null;
  stats: {
    avgScore: number | null;
    currentWeight: number | null;
    weightChange: number | null;
    recordDays: number;
  };
}

/** GET /trends?range=7|30|90 */
export const getTrends = (range: number) =>
  request<TrendResult>({ url: `/trends?range=${range}` });
