import { ACTIVITY_FACTORS, DEFAULT_AGE, DEFAULT_HEIGHT_CM, DEFAULT_WEIGHT_KG } from './constants';

export interface EnergyInput {
  gender: string; // male|female|other
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: string;
  intakeCalories: number;
  activeCalories: number; // 日常活动消耗(设备/步数衍生)
  exerciseCalories: number; // 正式运动消耗
}

export interface EnergyResult {
  bmr: number;
  tdee: number;
  burnCalories: number;
  netCalories: number;
  /** 数据完整度(身高/体重/年龄缺失则降低) */
  confidence: number;
}

/**
 * BMR — Mifflin-St Jeor 公式
 * 男: 10*kg + 6.25*cm - 5*age + 5
 * 女: 10*kg + 6.25*cm - 5*age - 161
 */
export function calcBMR(input: Pick<EnergyInput, 'gender' | 'age' | 'heightCm' | 'weightKg'>): number {
  const kg = input.weightKg ?? DEFAULT_WEIGHT_KG;
  const cm = input.heightCm ?? DEFAULT_HEIGHT_CM;
  const age = input.age ?? DEFAULT_AGE;
  const base = 10 * kg + 6.25 * cm - 5 * age;
  return input.gender === 'female' ? base - 161 : base + 5;
}

/** TDEE = BMR × 活动系数 */
export function calcTDEE(bmr: number, activityLevel: string): number {
  const factor = ACTIVITY_FACTORS[activityLevel] ?? ACTIVITY_FACTORS.moderate;
  return bmr * factor;
}

/**
 * 总消耗 = BMR(静息) + activeCalories(日常活动,来自设备/步数) + exerciseCalories(正式运动)
 *
 * 注意:TDEE 不参与实际消耗累加 —— TDEE = BMR × 活动系数 已隐含日常活动,
 * 若再叠加 activeCalories 会重复计入活动消耗(导致缺口虚大)。
 * TDEE 仅用于推算"目标摄入热量"(见 nutrition.calcMacroTarget)。
 * 设备热量按 confidence 由调用方加权后传入,不当绝对真值。
 */
export function calcEnergy(input: EnergyInput): EnergyResult {
  const bmr = calcBMR(input);
  const tdee = calcTDEE(bmr, input.activityLevel);
  const burnCalories = bmr + input.activeCalories + input.exerciseCalories;
  const netCalories = input.intakeCalories - burnCalories;

  // confidence:缺数据则降低
  let confidence = 1;
  if (input.weightKg == null) confidence -= 0.3;
  if (input.heightCm == null) confidence -= 0.2;
  if (input.age == null) confidence -= 0.15;

  return { bmr, tdee, burnCalories, netCalories, confidence: Math.max(0.3, confidence) };
}
