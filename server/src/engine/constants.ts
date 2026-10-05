/**
 * 计算引擎常量 — 系数、权重、目标分配。
 * 版本号写入 DailySummary.engineVersion,公式升级后可批量回填。
 */
export const ENGINE_VERSION = 'v1';

/** 活动水平 → TDEE 系数 */
export const ACTIVITY_FACTORS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};

/** BodyScore 5 维权重(和为 1) */
export const SCORE_WEIGHTS = {
  energy: 0.30,
  nutrition: 0.25,
  activity: 0.20,
  recovery: 0.10,
  goal: 0.15
} as const;

/** 目标类型 → 热量调整比例 */
export const GOAL_CALORIE_ADJUST: Record<string, number> = {
  fat_loss: -0.20,
  muscle_gain: 0.15,
  maintain: 0,
  endurance: 0.05
};

/** 目标类型 → 宏量分配(占目标热量百分比) */
export const MACRO_SPLIT: Record<string, { protein: number; carb: number; fat: number }> = {
  fat_loss: { protein: 0.35, carb: 0.35, fat: 0.30 },
  muscle_gain: { protein: 0.30, carb: 0.45, fat: 0.25 },
  maintain: { protein: 0.25, carb: 0.50, fat: 0.25 },
  endurance: { protein: 0.20, carb: 0.60, fat: 0.20 }
};

/** 每千克体重目标蛋白(g/kg) */
export const PROTEIN_PER_KG: Record<string, number> = {
  fat_loss: 1.6,
  muscle_gain: 1.8,
  maintain: 1.4,
  endurance: 1.4
};

/** 宏量营养素热量密度(kcal/g) */
export const KCAL_PER_GRAM = { protein: 4, carb: 4, fat: 9 };

/** 步数基准(满活动分) */
export const STEP_GOAL = 10000;
/** 每日运动时长基准(满活动分,分钟) */
export const EXERCISE_MIN_GOAL = 30;
/** 每步约消耗 kcal(粗估) */
export const KCAL_PER_STEP = 0.04;

/** 无年龄数据时的默认年龄 */
export const DEFAULT_AGE = 30;
/** 无身高数据时的默认身高(cm) */
export const DEFAULT_HEIGHT_CM = 170;
/** 无体重数据时的默认体重(kg) */
export const DEFAULT_WEIGHT_KG = 65;

export function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}
