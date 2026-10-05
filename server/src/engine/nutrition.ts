import { GOAL_CALORIE_ADJUST, MACRO_SPLIT, KCAL_PER_GRAM, PROTEIN_PER_KG } from './constants';

export interface NutritionAggregate {
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  [key: string]: number;
}

/** 目标宏量(基于目标类型与体重/目标热量) */
export interface MacroTarget {
  targetCalories: number; // 目标摄入热量
  targetProteinG: number;
  targetCarbG: number;
  targetFatG: number;
}

export function calcMacroTarget(params: {
  tdee: number;
  goalType: string;
  weightKg: number;
}): MacroTarget {
  const adjust = GOAL_CALORIE_ADJUST[params.goalType] ?? 0;
  const targetCalories = params.tdee * (1 + adjust);
  const split = MACRO_SPLIT[params.goalType] ?? MACRO_SPLIT.maintain;

  // 蛋白按体重定;碳水/脂肪按剩余热量配比反推
  const targetProteinG = params.weightKg * (PROTEIN_PER_KG[params.goalType] ?? 1.5);
  const proteinKcal = targetProteinG * KCAL_PER_GRAM.protein;
  const remainingKcal = Math.max(0, targetCalories - proteinKcal);
  const targetCarbG = (remainingKcal * split.carb) / KCAL_PER_GRAM.carb;
  const targetFatG = (remainingKcal * split.fat) / KCAL_PER_GRAM.fat;

  return { targetCalories, targetProteinG, targetCarbG, targetFatG };
}

/** 营养评分(0-100):蛋白达标度 60% + 宏量均衡 40% */
export function nutritionScore(actual: NutritionAggregate, target: MacroTarget): number {
  const proteinRatio = target.targetProteinG > 0 ? actual.proteinG / target.targetProteinG : 0;
  const proteinPart = Math.min(proteinRatio, 1.2) / 1.2 * 60;

  // 均衡度:实际宏量热量占比与目标占比的差异
  const totalKcal =
    actual.proteinG * KCAL_PER_GRAM.protein +
    actual.carbG * KCAL_PER_GRAM.carb +
    actual.fatG * KCAL_PER_GRAM.fat;
  let balance = 40;
  if (totalKcal > 0) {
    const pShare = (actual.proteinG * KCAL_PER_GRAM.protein) / totalKcal;
    const cShare = (actual.carbG * KCAL_PER_GRAM.carb) / totalKcal;
    const fShare = (actual.fatG * KCAL_PER_GRAM.fat) / totalKcal;
    // 与均衡基准(蛋白30/碳水45/脂肪25)的偏差越小越好
    const diff =
      Math.abs(pShare - 0.3) + Math.abs(cShare - 0.45) + Math.abs(fShare - 0.25);
    balance = Math.max(0, 40 - diff * 80);
  }
  return Math.round(proteinPart + balance);
}
