import { request } from './request';
import type { MacroTarget } from './types';

export type { MacroTarget };

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
  /** 昨晚睡眠时长(分钟),0 = 没记 */
  sleepMinutes: number;
  /** 当天三大营养素合计(服务端已按天汇总好,客户端只负责加与显示) */
  nutrition: MacroTotals;
}

/** 每日宏量合计。字段口径见 utils/nutrition.ts 的文件头 */
export interface MacroTotals {
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface WeightPoint {
  date: string;
  weightKg: number;
}

/** 平台期判定(纯规则,见 server engine/plateau.ts):只在「最近三周称得够勤且体重没动」时非空 */
export interface PlateauInfo {
  days: number;
  records: number;
  changeKg: number;
}

export interface TrendResult {
  range: number;
  summaries: TrendDay[];
  weights: WeightPoint[];
  macroTarget: MacroTarget | null;
  /** 进行中的目标下「体重三周没动」的判定;没卡住或数据不够时为 null(不下结论) */
  plateau: PlateauInfo | null;
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
