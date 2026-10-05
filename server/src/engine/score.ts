import { SCORE_WEIGHTS, STEP_GOAL, EXERCISE_MIN_GOAL, clamp } from './constants';

export interface ScoreInput {
  /** 净值偏离目标净值的程度(越小越好) */
  netCalories: number;
  targetNetCalories: number;
  targetCalories: number;
  /** 营养分(来自 nutrition.ts) */
  nutritionScore: number;
  /** 活动输入 */
  steps: number;
  exerciseMin: number;
  /** 目标分(来自 goal.ts) */
  goalScore: number;
  /** 是否连续有记录(用于恢复分近似) */
  hasRecentRecords: boolean;
  /** 连续记录天数(恢复分) */
  consecutiveDays: number;
  /** 近 N 天体重日间波动幅度 % (恢复分) */
  weightVolatilityPct: number;
}

/** 能量分:净值偏离目标越小越高 */
export function energyScore(input: Pick<ScoreInput, 'netCalories' | 'targetNetCalories' | 'targetCalories'>): number {
  const deviation = Math.abs(input.netCalories - input.targetNetCalories);
  const denom = input.targetCalories > 0 ? input.targetCalories : 2000;
  return Math.round(clamp(100 - (deviation / denom) * 100));
}

/** 活动分:步数 50% + 运动时长 50% */
export function activityScore(steps: number, exerciseMin: number): number {
  const stepPart = Math.min(steps / STEP_GOAL, 1) * 50;
  const exPart = Math.min(exerciseMin / EXERCISE_MIN_GOAL, 1) * 50;
  return Math.round(stepPart + exPart);
}

/**
 * 恢复分:MVP 无睡眠数据,用两个可观测代理指标近似:
 * 1) 连续记录天数(自律/规律性的间接信号)
 * 2) 体重波动稳定性(短期大幅波动≈疲劳/脱水/暴食,扣分)
 * 缺睡眠数据,封顶 80(诚实标注,不给满分)。
 */
export function recoveryScore(params: {
  hasRecentRecords: boolean;
  consecutiveDays: number;
  weightVolatilityPct: number; // 近 N 天体重日间波动幅度(%)
}): number {
  const { consecutiveDays, weightVolatilityPct } = params;
  let score = 60;
  // 规律记录加分:每多一天连续 +3,最多 +15
  score += Math.min(15, consecutiveDays * 3);
  // 体重稳定加分/扣分:波动 <1% 视为恢复良好
  if (weightVolatilityPct < 1) score += 5;
  else if (weightVolatilityPct > 2.5) score -= Math.min(10, (weightVolatilityPct - 2.5) * 5);
  // 封顶 80(缺睡眠数据,不给满分)
  return Math.round(Math.max(40, Math.min(80, score)));
}

/** BodyScore = Σ(权重 × 维度分) */
export function bodyScore(input: ScoreInput): {
  bodyScore: number;
  energyScore: number;
  nutritionScore: number;
  activityScore: number;
  recoveryScore: number;
  goalScore: number;
} {
  const energy = energyScore(input);
  const activity = activityScore(input.steps, input.exerciseMin);
  const recovery = recoveryScore({
    hasRecentRecords: input.hasRecentRecords,
    consecutiveDays: input.consecutiveDays,
    weightVolatilityPct: input.weightVolatilityPct
  });

  const total =
    SCORE_WEIGHTS.energy * energy +
    SCORE_WEIGHTS.nutrition * input.nutritionScore +
    SCORE_WEIGHTS.activity * activity +
    SCORE_WEIGHTS.recovery * recovery +
    SCORE_WEIGHTS.goal * input.goalScore;

  return {
    bodyScore: Math.round(clamp(total)),
    energyScore: energy,
    nutritionScore: Math.round(input.nutritionScore),
    activityScore: activity,
    recoveryScore: recovery,
    goalScore: Math.round(input.goalScore)
  };
}
