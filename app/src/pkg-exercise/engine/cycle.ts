/**
 * 周期与波次 — 把「每次都往上加」换成「几周一个循环」。
 *
 * 两种走法:
 *   line 爬坡 + 减载 —— 三周照常练,第四周主动减载(重量 ×0.8、组数 -1)。
 *                       大众用户最需要的其实只是这个「定期歇一周」,其他三周不动。
 *   531  5/3/1 波次  —— 主项按训练最大重量的百分比开重量,四周一轮
 *                       (5 次周 → 3 次周 → 冲顶周 → 减载周),一轮结束基准上调一档。
 *
 * 实现上,**波次只是「看的时候套上去」的一层**(applyCycle 返回派生计划,不落库):
 * 存下来的计划永远是最朴素的那份,用户哪天不想走周期了,关掉就回到原样。
 * 走 531 时主项会被打上 cycleLocked,常规渐进对它让位 —— 否则波次开的重量
 * 和渐进加的重量会互相打架。
 */
import { estMinutes, findExercise } from './generator';
import { bumpMax, loadMaxes, pctOfTm, tmOf, type MaxMap } from './max';
import { round2 } from './onerm';
import type { PlannedExercise, TrainingPlan } from './types';

/** 与 TrainingPlan.cycle.style 同源(类型定义收口在 types.ts,避免循环依赖) */
export type CycleStyle = NonNullable<TrainingPlan['cycle']>['style'];

export interface CycleState {
  style: CycleStyle;
  /** 第几周(1 起) */
  week: number;
}

export const CYCLE_ZH: Record<CycleStyle, string> = {
  line: '爬坡 + 减载',
  '531': '5/3/1 波次'
};
export const CYCLE_DESC: Record<CycleStyle, string> = {
  line: '三周照常练,第四周自动减载(重量降到八成、少做一组)。适合大多数人,不容易练着练着就累垮。',
  '531': '只有主项(深蹲/硬拉/卧推这类复合动作)按训练最大重量的百分比开重量,四周一轮:5 次周 → 3 次周 → 冲顶周 → 减载周,一轮结束后基准上调一档。'
};

/** 一周的处方(前 3 周爬坡,第 4 周减载) */
export interface CycleWeek {
  label: string;
  tip: string;
  /** 531:末组占训练最大重量的比例 */
  top?: number;
  sets?: number;
  repsMin?: number;
  repsMax?: number;
  /** line:相对当前重量的系数 */
  scale?: number;
  deload?: boolean;
}

const W531: CycleWeek[] = [
  { label: '第 1 周 · 5 次', tip: '三组依次加重,每组 5 次;最后一组做完还有余力就继续做', top: 0.85, sets: 3, repsMin: 5, repsMax: 5 },
  { label: '第 2 周 · 3 次', tip: '重量再上一档,每组 3 次;最后一组做完还有余力就继续做', top: 0.9, sets: 3, repsMin: 3, repsMax: 3 },
  { label: '第 3 周 · 冲顶', tip: '这一周最重:5 次 → 3 次 → 1 次,最后一组能多做就多做', top: 0.95, sets: 3, repsMin: 1, repsMax: 5 },
  { label: '第 4 周 · 减载', tip: '轻重量,每组 5 次就收;这一周不要拼,让身体恢复', top: 0.6, sets: 3, repsMin: 5, repsMax: 5, deload: true }
];

const WLINE: CycleWeek[] = [
  { label: '第 1 周 · 打基础', tip: '照常练,把动作做标准,不急着冲重量' },
  { label: '第 2 周 · 加重', tip: '照常练,状态好的动作可以加一档' },
  { label: '第 3 周 · 冲一冲', tip: '这一周可以冲一冲,把目标次数做满' },
  { label: '第 4 周 · 减载', tip: '主动减载:重量降到八成、少做一组,让身体恢复', scale: 0.8, deload: true }
];

/** 该周期的四周安排 */
export function cycleWeeks(style: CycleStyle): CycleWeek[] {
  return style === '531' ? W531 : WLINE;
}

export function cycleOf(plan: TrainingPlan): CycleState | null {
  return plan.cycle ?? null;
}

export function cycleSummary(plan: TrainingPlan): string | null {
  const c = plan.cycle;
  if (!c) return null;
  const weeks = cycleWeeks(c.style);
  const w = weeks[Math.min(Math.max(c.week, 1), weeks.length) - 1];
  return `第 ${c.week}/${weeks.length} 周 · ${w.label.replace(/^第 \d+ 周 · /, '')}`;
}

/** 开启 / 关闭周期(开启时周次回到第 1 周) */
export function setCycle(plan: TrainingPlan, style: CycleStyle | null): TrainingPlan {
  if (!style) {
    const { cycle: _drop, ...rest } = plan;
    return rest as TrainingPlan;
  }
  return { ...plan, cycle: { style, week: 1 } };
}

/** 该动作适不适合走波次:有配重的复合动作,而且已经有余力基准 */
export function waveEligible(it: PlannedExercise, maxes: MaxMap): boolean {
  if (it.weightKg == null || it.weightStepKg <= 0) return false;
  if (!tmOf(maxes, it.exerciseId)) return false;
  return findExercise(it.exerciseId)?.mechanic === 'compound';
}

/** 末组尽力(AMRAP)只挂在需要拼的周 — 减载周不该让人做到力竭 */
function withAmrap(it: PlannedExercise, on: boolean): PlannedExercise {
  if (on) return { ...it, amrapLast: true };
  if (!it.amrapLast) return it;
  const { amrapLast: _drop, ...rest } = it;
  return rest as PlannedExercise;
}

/** 531:按训练最大重量重写一组主项 */
function wave531(it: PlannedExercise, week: CycleWeek, maxes: MaxMap): PlannedExercise {
  const tm = tmOf(maxes, it.exerciseId) as number;
  const step = it.weightStepKg;
  const top = pctOfTm(tm, week.top as number, step);
  return withAmrap({
    ...it,
    sets: week.sets as number,
    repsMin: week.repsMin as number,
    repsMax: week.repsMax as number,
    weightKg: top,
    restSec: Math.max(it.restSec, 180), // 主项组间给足 3 分钟
    setType: 'pyramid',
    cycleLocked: true
  }, !week.deload);
}

/** 减载周:重量降到八成、少做一组(自重动作只减组) */
function deload(it: PlannedExercise): PlannedExercise {
  return {
    ...it,
    sets: Math.max(2, it.sets - 1),
    weightKg: it.weightKg == null ? null : round2(Math.max(it.weightStepKg, Math.round(it.weightKg * 0.8 * 2) / 2))
  };
}

/**
 * 套用当前周次 — 返回派生计划(不落库)。
 * 没有开启周期时原样返回,页面可以无脑调用。
 */
export function applyCycle(plan: TrainingPlan, maxes: MaxMap = loadMaxes()): TrainingPlan {
  const c = cycleOf(plan);
  if (!c) return plan;
  const weeks = cycleWeeks(c.style);
  const week = weeks[Math.min(Math.max(c.week, 1), weeks.length) - 1];

  /** 组次变了要重算单堂时长,否则「约 X 分钟」还是老数字 */
  const reday = (d: (typeof plan.days)[number], items: typeof d.items) => ({ ...d, items, estMin: estMinutes(items) });

  if (c.style === 'line') {
    if (!week.deload) return plan; // 非减载周照常
    return { ...plan, days: plan.days.map((d) => reday(d, d.items.map(deload))) };
  }
  return {
    ...plan,
    days: plan.days.map((d) => reday(d, d.items.map((it) => (
      waveEligible(it, maxes) ? wave531(it, week, maxes) : withAmrap(it, false)
    ))))
  };
}

/**
 * 进入下一周 — 满一轮则把走波次的主项的基准上调一档,再回到第 1 周。
 * 只动「有基准的复合动作」,孤立动作仍旧走常规渐进。
 */
export function advanceCycle(plan: TrainingPlan, maxes: MaxMap = loadMaxes()): TrainingPlan {
  const c = cycleOf(plan);
  if (!c) return plan;
  const len = cycleWeeks(c.style).length;

  if (c.week < len) return { ...plan, cycle: { ...c, week: c.week + 1 } };

  // 走满一轮:主项基准上调一档(下次按更高的百分比开重量)
  if (c.style === '531') {
    const seen = new Set<string>();
    for (const d of plan.days) {
      for (const it of d.items) {
        if (seen.has(it.exerciseId) || !waveEligible(it, maxes)) continue;
        seen.add(it.exerciseId);
        bumpMax(it.exerciseId, it.nameZh, Math.min(it.weightStepKg, 5));
      }
    }
  }
  return { ...plan, cycle: { ...c, week: 1 } };
}
