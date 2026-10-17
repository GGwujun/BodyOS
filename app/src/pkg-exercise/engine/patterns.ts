/**
 * 动作模式目录 + 分化模板 + 目标/水平调制。
 * 槽位只描述「要什么类型的动作」,具体动作由 generator.ts 从动作库选定。
 */
import type { Goal, Level, EquipAccess } from './types';

/** 动作模式 — 一类生物力学功能的动作集合 */
export interface Pattern {
  id: string;
  zhName: string;
  /** 候选部位(按优先级) */
  bodyParts: string[];
  /** 偏好发力方向 */
  force?: 'push' | 'pull';
  /** 主项动作优先复合 */
  prefersCompound: boolean;
  /** 该模式偏好的器械(加分项,如深蹲在健身房优先杠铃) */
  prefEq?: string[];
}

export const PATTERNS: Record<string, Pattern> = {
  squat: { id: 'squat', zhName: '深蹲类', bodyParts: ['upper legs'], force: 'push', prefersCompound: true, prefEq: ['barbell', 'smith machine', 'dumbbell'] },
  hinge: { id: 'hinge', zhName: '硬拉/臀桥类', bodyParts: ['upper legs'], force: 'pull', prefersCompound: true, prefEq: ['barbell', 'dumbbell', 'kettlebell'] },
  lunge: { id: 'lunge', zhName: '弓步/单腿类', bodyParts: ['upper legs'], force: 'push', prefersCompound: true },
  calf: { id: 'calf', zhName: '提踵类', bodyParts: ['lower legs'], prefersCompound: false },
  hpush: { id: 'hpush', zhName: '水平推(俯卧撑/卧推类)', bodyParts: ['chest'], force: 'push', prefersCompound: true, prefEq: ['barbell', 'dumbbell'] },
  vpush: { id: 'vpush', zhName: '垂直推(肩推类)', bodyParts: ['shoulders', 'chest'], force: 'push', prefersCompound: true, prefEq: ['dumbbell', 'barbell'] },
  fly: { id: 'fly', zhName: '飞鸟/夹胸类', bodyParts: ['chest'], force: 'push', prefersCompound: false },
  hpull: { id: 'hpull', zhName: '水平拉(划船类)', bodyParts: ['back'], force: 'pull', prefersCompound: true, prefEq: ['barbell', 'dumbbell', 'cable'] },
  vpull: { id: 'vpull', zhName: '垂直拉(引体/下拉类)', bodyParts: ['back'], force: 'pull', prefersCompound: true, prefEq: ['cable', 'leverage machine'] },
  rfly: { id: 'rfly', zhName: '反向飞鸟(肩后束)', bodyParts: ['shoulders'], force: 'pull', prefersCompound: false },
  curl: { id: 'curl', zhName: '弯举类(肱二头肌)', bodyParts: ['upper arms'], force: 'pull', prefersCompound: false },
  tri: { id: 'tri', zhName: '臂屈伸类(肱三头肌)', bodyParts: ['upper arms'], force: 'push', prefersCompound: false },
  core: { id: 'core', zhName: '核心训练', bodyParts: ['waist'], prefersCompound: false },
  swing: { id: 'swing', zhName: '壶铃摆荡/爆发类', bodyParts: ['upper legs', 'back'], prefersCompound: true },
  finisher: { id: 'finisher', zhName: '有氧收尾', bodyParts: ['cardio', 'waist'], prefersCompound: false }
};

/** 器械条件 → 允许的 equipment 集合 */
export const ACCESS_EQUIP: Record<EquipAccess, Set<string>> = {
  body: new Set(['body weight']),
  dumbbell: new Set(['body weight', 'dumbbell']),
  home: new Set(['body weight', 'dumbbell', 'kettlebell', 'band', 'resistance band', 'medicine ball']),
  gym: new Set([
    'body weight', 'dumbbell', 'kettlebell', 'barbell', 'ez barbell', 'olympic barbell', 'trap bar',
    'cable', 'leverage machine', 'smith machine', 'band', 'resistance band', 'medicine ball', 'weighted', 'rope'
  ])
};

/** 分化日模板:动作模式 id 的有序列表 */
const FULL_A = ['squat', 'hpush', 'hpull', 'core'];
const FULL_B = ['hinge', 'vpush', 'vpull', 'core'];
const FULL_C = ['lunge', 'hpush', 'hpull', 'tri', 'core'];
const PUSH = ['hpush', 'vpush', 'fly', 'tri', 'core'];
const PULL = ['vpull', 'hpull', 'rfly', 'curl', 'core'];
const LEGS = ['squat', 'hinge', 'lunge', 'calf', 'core'];
const UPPER_A = ['hpush', 'hpull', 'vpush', 'vpull', 'curl', 'tri'];
const LOWER_A = ['squat', 'hinge', 'calf', 'core'];
const UPPER_B = ['fly', 'rfly', 'curl', 'tri', 'core'];
const LOWER_B = ['lunge', 'hinge', 'calf', 'core'];

export interface DayTemplate {
  key: string;
  title: string;
  focus: string;
  patterns: string[];
}

/** 按天数(+水平)给出分化方案 */
export function buildSplit(days: number, level: Level): DayTemplate[] {
  if (days <= 2) {
    return [
      { key: 'full-a', title: '全身 A', focus: '蹲 + 推 + 拉', patterns: FULL_A },
      { key: 'full-b', title: '全身 B', focus: '髋 + 推 + 拉', patterns: FULL_B }
    ];
  }
  if (days === 3) {
    return level === 'beginner'
      ? [
        { key: 'full-a', title: '全身 A', focus: '蹲 + 推 + 拉', patterns: FULL_A },
        { key: 'full-b', title: '全身 B', focus: '髋 + 推 + 拉', patterns: FULL_B },
        { key: 'full-c', title: '全身 C', focus: '单腿 + 推 + 拉', patterns: FULL_C }
      ]
      : [
        { key: 'push', title: '推日', focus: '胸 + 肩 + 手臂后侧', patterns: PUSH },
        { key: 'pull', title: '拉日', focus: '背 + 手臂前侧', patterns: PULL },
        { key: 'legs', title: '腿日', focus: '下肢 + 核心', patterns: LEGS }
      ];
  }
  if (days === 4) {
    return [
      { key: 'upper-a', title: '上肢 A', focus: '推拉双主线', patterns: UPPER_A },
      { key: 'lower-a', title: '下肢 A', focus: '蹲为主', patterns: LOWER_A },
      { key: 'upper-b', title: '上肢 B', focus: '孤立补弱', patterns: UPPER_B },
      { key: 'lower-b', title: '下肢 B', focus: '单腿 + 髋', patterns: LOWER_B }
    ];
  }
  if (days === 5) {
    return [
      { key: 'push', title: '推日', focus: '胸 + 肩 + 手臂后侧', patterns: PUSH },
      { key: 'pull', title: '拉日', focus: '背 + 手臂前侧', patterns: PULL },
      { key: 'legs', title: '腿日', focus: '下肢 + 核心', patterns: LEGS },
      { key: 'upper-b', title: '上肢补充', focus: '孤立补弱', patterns: UPPER_B },
      { key: 'lower-b', title: '下肢补充', focus: '单腿 + 髋', patterns: LOWER_B }
    ];
  }
  return [
    { key: 'push-a', title: '推日 A', focus: '胸 + 肩 + 手臂后侧', patterns: PUSH },
    { key: 'pull-a', title: '拉日 A', focus: '背 + 手臂前侧', patterns: PULL },
    { key: 'legs-a', title: '腿日 A', focus: '下肢 + 核心', patterns: LEGS },
    { key: 'push-b', title: '推日 B', focus: '胸 + 肩 + 手臂后侧', patterns: PUSH },
    { key: 'pull-b', title: '拉日 B', focus: '背 + 手臂前侧', patterns: PULL },
    { key: 'legs-b', title: '腿日 B', focus: '下肢 + 核心', patterns: LEGS }
  ];
}

/** 目标 → 组次数/休息调制 */
export interface SetScheme {
  sets: number;
  repsMin: number;
  repsMax: number;
  restSec: number;
}

const GOAL_MAIN: Record<Goal, SetScheme> = {
  fatloss: { sets: 3, repsMin: 12, repsMax: 15, restSec: 60 },
  muscle: { sets: 3, repsMin: 8, repsMax: 12, restSec: 90 },
  endurance: { sets: 3, repsMin: 15, repsMax: 20, restSec: 45 }
};

/** 核心与孤立动作的次数区间更高、休息更短 */
export function schemeFor(goal: Goal, kind: 'main' | 'accessory' | 'core' | 'finisher'): SetScheme {
  const base = GOAL_MAIN[goal];
  if (kind === 'accessory') return { ...base, sets: Math.max(2, base.sets - 1), restSec: Math.min(base.restSec, 60) };
  if (kind === 'core') return { sets: 3, repsMin: Math.max(12, base.repsMin), repsMax: Math.max(20, base.repsMax), restSec: 45 };
  return base; // finisher 与主项同区间(次数语义即秒数的近似)
}

/** 槽位类型:主项/辅项/核心/收尾 */
export function slotKind(patternId: string): 'main' | 'accessory' | 'core' | 'finisher' {
  if (patternId === 'core') return 'core';
  if (patternId === 'finisher') return 'finisher';
  if (['fly', 'rfly', 'curl', 'tri', 'calf'].includes(patternId)) return 'accessory';
  return 'main';
}

/** 新手修剪模板过长的孤立项,并按单次时长限制动作数 */
export function trimPatterns(patterns: string[], level: Level, sessionMin: number): string[] {
  const capByTime = sessionMin <= 30 ? 4 : sessionMin <= 40 ? 5 : sessionMin <= 50 ? 6 : 7;
  const cap = Math.min(capByTime, level === 'beginner' ? 5 : 7);
  // 优先保留排在前面的主项
  return patterns.slice(0, Math.max(3, cap));
}
