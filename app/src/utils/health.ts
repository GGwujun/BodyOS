/**
 * 身体指标计算 — 与后端 engine/energy.ts、工具页 BMI 标准保持同一口径。
 * BMI 采用中国成人标准;BMR 采用 Mifflin-St Jeor 公式估算。
 */

export type BmiTone = 'blue' | 'green' | 'amber' | 'red';

export interface BmiBand {
  label: string;
  tone: BmiTone;
  range: string;
}

/** BMI = 体重(kg) ÷ 身高(m)²;身高体重缺失时返回 null */
export function bmiOf(weightKg?: number | null, heightCm?: number | null): number | null {
  if (weightKg == null || heightCm == null || weightKg <= 0 || heightCm <= 0) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** 中国成人标准:偏瘦 <18.5,正常 18.5~23.9,超重 24~27.9,肥胖 ≥28 */
export function bmiBand(bmi: number): BmiBand {
  if (bmi < 18.5) return { label: '偏瘦', tone: 'blue', range: '低于 18.5' };
  if (bmi < 24) return { label: '正常', tone: 'green', range: '18.5 ~ 23.9' };
  if (bmi < 28) return { label: '超重', tone: 'amber', range: '24 ~ 27.9' };
  return { label: '肥胖', tone: 'red', range: '28 及以上' };
}

export const BMI_NORMAL_RANGE = '18.5 ~ 23.9';

/** 活动系数,与后端 ACTIVITY_FACTORS 一致 */
const ACTIVITY_FACTOR_MAP: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};

export interface BmrInput {
  gender?: string | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
}

/**
 * BMR(Mifflin-St Jeor 公式估算):
 * 男 10×kg + 6.25×cm − 5×age + 5;女同式 − 161。
 * 与后端 calcBMR 同口径(非 female 按 +5 处理)。
 */
export function calcBmr(input: BmrInput): number | null {
  const { gender, age, heightCm, weightKg } = input;
  if (weightKg == null || heightCm == null || age == null) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === 'female' ? base - 161 : base + 5;
}

/** TDEE = BMR × 活动系数(缺资料按中度活动估) */
export function calcTdee(bmr: number, activityLevel?: string | null): number {
  const factor = ACTIVITY_FACTOR_MAP[activityLevel ?? 'moderate'] ?? ACTIVITY_FACTOR_MAP.moderate;
  return bmr * factor;
}

/** 由出生日期算周岁,无效返回 null */
export function ageOf(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}
