/**
 * 1RM 估算 — 7 个公开的经典公式(Epley/Brzycki/Lander/Lombardi/Mayhew/O'Conner/Wathan)。
 * 取中位数以抵抗单公式在极端次数下的偏差;重量单位 kg。
 *
 * 调用方一般该用下面的 `e1rmOf`(它管次数上限与单侧折算),而不是直接调 `estimate1RM`;
 * **知道动作 id 时更要用 `load.liftE1rm`** —— 它在这之上还排除了助力器械
 * (助力动作的「重量」越大越轻松,算出来的 1RM 是反的,见 engine/load.ts)。
 * 这个文件保持成纯粹的数学:它不认识动作库,也不该认识。
 */
import { sideReps } from './types';

export interface OneRMFormula {
  name: string;
  calc: (weightKg: number, reps: number) => number;
}

const FORMULAS: OneRMFormula[] = [
  { name: 'Epley', calc: (w, r) => w * (1 + r / 30) },
  { name: 'Brzycki', calc: (w, r) => (w * 36) / (37 - r) },
  { name: 'Lander', calc: (w, r) => (100 * w) / (101.3 - 2.67123 * r) },
  { name: 'Lombardi', calc: (w, r) => w * Math.pow(r, 0.1) },
  { name: 'Mayhew', calc: (w, r) => (100 * w) / (52.2 + 41.9 * Math.exp(-0.055 * r)) },
  { name: "O'Conner", calc: (w, r) => w * (1 + 0.025 * r) },
  { name: 'Wathan', calc: (w, r) => (100 * w) / (48.8 + 53.8 * Math.exp(-0.075 * r)) }
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** 估算单次最大重量(r 越大越不准,超过 12 次仅作参考) */
export const estimate1RM = (weightKg: number, reps: number): number => {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  // 次数越界公式会发散(Brzcki 37-r),截断到 [1,15]
  const r = Math.min(Math.max(reps, 1), 15);
  return round2(median(FORMULAS.map((f) => f.calc(weightKg, r))));
};

/** 超过这个次数就不给 1RM(外推得太远,数字是编的) */
export const E1RM_MAX_REPS = 12;

/**
 * 一组动作的 1RM —— **不知道动作 id 的纯数学场景从这里进**;
 * 手里有动作 id 就再上一层用 `load.liftE1rm`,别直接调 `estimate1RM`。
 *
 * 两件事只有放在这一个闸门里才不会漏:
 *  1. **单侧动作要折成单侧次数**(`sideReps`)。Epley 拿 24 次外推和拿 12 次外推差得远,
 *     而「两侧合计 24 次」的真实含义就是「每侧 12 次」。
 *  2. **次数上限也按单侧次数判**。合计 24 次(每侧 12)是一组很标准的单侧数据,
 *     要是拿总数去套 12 次的上限,单侧动作的 1RM 会**一条都算不出来**(而这不是报错,
 *     是悄悄没有纪录、没有基准)。
 * 重量或次数不合法(包括折完只剩 0)一律返回 0,调用方按「没有成绩」处理。
 */
export function e1rmOf(
  weightKg: number | null | undefined,
  reps: number,
  sided = false,
  maxReps = E1RM_MAX_REPS
): number {
  const w = weightKg ?? 0;
  const per = sideReps(reps, sided);
  if (!(w > 0) || !(per > 0) || per > maxReps) return 0;
  return estimate1RM(w, per);
}

/** 由 1RM 反推某百分比下的次数(经验表 RPE 简化) */
export const repsAtPct = (pct: number): number => {
  if (pct >= 0.95) return 2;
  if (pct >= 0.9) return 4;
  if (pct >= 0.85) return 6;
  if (pct >= 0.8) return 8;
  if (pct >= 0.75) return 10;
  if (pct >= 0.7) return 12;
  return 15;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export { round2 };
