/**
 * 训练最大重量(TM, Training Max)— 每个动作的力量基准值。
 *
 * 由历史日志自动估算:取历史最好的一组(次数 ≤ 10 才算数)× 0.9。
 * 取 1RM 的 90% 而不是 1RM 本身,是力量训练里的通用做法 —— 留出余量,
 * 每周的加重都从「有余量」的地方出发,不容易一上来就顶死,也更抗状态波动。
 * 用户也可以手动改(测过一次极限、或器械单位对不上时)。
 *
 * 两个用途:
 *  1. 展示「这个重量是你最大重量的百分之多少」—— 让用户知道自己今天练得重不重;
 *  2. 波次/周期计划按 %1RM 直接开重量(见 cycle.ts)。
 */
import Taro from '@tarojs/taro';
import { markTouched } from '../../utils/sync-marks';
import { isAssisted, liftE1rm } from './load';
import { e1rmOf, round2 } from './onerm';
import { isSided } from './sided';
import { loadLogs } from './store';
import { countsForProgress, entryCounts, type WorkoutLog } from './types';

/** TM 占估算 1RM 的比例 */
export const MAX_FACTOR = 0.9;
/** 估计 1RM 时超过这个次数的组不参与(次数越多估算越离谱) */
const E1RM_MAX_REPS = 10;
/** 只给「练够次数」的动作建基准 — 偶然试一次的重量不足以代表力量水平 */
const MIN_SETS_FOR_MAX = 2;

export interface MaxEntry {
  exerciseId: string;
  nameZh: string;
  /** 估算的 1RM(kg) */
  e1rmKg: number;
  /** 训练最大重量 = e1rm × 0.9,已对齐加重步长 */
  tmKg: number;
  /** auto = 由日志推算(会被更好的成绩刷新);manual = 用户自己填的(不被覆盖) */
  source: 'auto' | 'manual';
  updatedAt: string;
}

export type MaxMap = Record<string, MaxEntry>;

const K_MAXES = 'bodyos.training.maxes';

/** 重量对齐到加重步长(和热身/组型用同一套规则,不出现配不出的重量) */
export function snapStep(kg: number, step: number): number {
  const unit = step > 0 ? step : 2.5;
  return Math.max(unit, Math.round(kg / unit) * unit);
}

export function loadMaxes(): MaxMap {
  const raw: MaxMap = Taro.getStorageSync(K_MAXES) || {};
  // 存量清理:助力器械在修复前也会被算出基准。读的时候滤掉(不写回,免得每次读取都落盘)——
  // 每一个读者(maxList / tmOf / pctOfWeight / cycle)都会经过这里,滤一处就全干净了。
  const stale = Object.keys(raw).filter((id) => isAssisted(id));
  if (!stale.length) return raw;
  const clean: MaxMap = { ...raw };
  for (const id of stale) delete clean[id];
  return clean;
}
export function saveMaxes(m: MaxMap): void {
  Taro.setStorageSync(K_MAXES, m);
  markTouched('maxes', 'main');
}

/** 某组能不能用来估 1RM(有配重、次数在合理区间);单侧动作折成单侧次数再判次数 */
function usableSet(reps: number, weightKg: number | null, sided: boolean): boolean {
  return e1rmOf(weightKg, reps, sided, E1RM_MAX_REPS) > 0;
}

/**
 * 一次训练里该动作最好的一组所对应的 1RM 估算值。
 * @param assisted 助力器械 —— 恒为 0:那个数字是器械帮你的力,越练越弱它反而越大,
 *   拿它定基准会把「越轻松越强」写进力量基准,波次还会照这个假基准开处方重量。
 */
export function bestE1rmOf(
  sets: { reps: number; weightKg: number | null }[],
  sided = false,
  assisted = false
): number {
  if (assisted) return 0;
  const usable = sets.filter((s) => usableSet(s.reps, s.weightKg, sided));
  if (usable.length < MIN_SETS_FOR_MAX) return 0;
  return Math.max(...usable.map((s) => e1rmOf(s.weightKg, s.reps, sided, E1RM_MAX_REPS)));
}

/**
 * 扫描全部日志,刷新自动推算的基准。
 * 手工填的条目原样保留 —— 用户填过的数字不该被算法改掉。
 * @param logs 不传则读本地日志
 */
export function syncMaxes(logs: WorkoutLog[] = loadLogs(), prev: MaxMap = loadMaxes()): MaxMap {
  const next: MaxMap = { ...prev };
  const now = new Date().toISOString();
  // 同一动作在多条日志里出现 — 取最好的那次
  const best = new Map<string, { nameZh: string; e1rm: number }>();
  for (const log of logs) {
    if (!countsForProgress(log)) continue; // 补录(记不准)与「这次不算」都不参与(都不该定基准)
    for (const e of log.entries) {
      // 只标了这个动作不算的那一条也不参与 —— 换了台器械举出的重量定不了基准。
      // **只跳过、不清存量**:下面的助力分支会用 delete 清掉旧条目(那是修复坏数据),
      // 而这一条是「这次不算」,他以前那把秤上的成绩还是真的,不该被抹掉
      if (!entryCounts(log, e)) continue;
      // 助力器械不建基准 —— 顺手把存量里的旧条目清掉:修复前按助力算出来的基准
      // 还躺在本地存储里(手工填的那条也一样),留着会被波次当成 %1RM 的依据。
      if (isAssisted(e.exerciseId)) { delete next[e.exerciseId]; continue; }
      const v = bestE1rmOf(e.sets, isSided(e.exerciseId));
      if (v <= 0) continue;
      const cur = best.get(e.exerciseId);
      if (!cur || v > cur.e1rm) best.set(e.exerciseId, { nameZh: e.nameZh, e1rm: v });
    }
  }
  for (const [exerciseId, { nameZh, e1rm }] of best) {
    const old = next[exerciseId];
    if (old?.source === 'manual') continue;
    // 取历史最好成绩,但不让基准无限期虚高:成绩没有刷新就不动它(降载由周期/减载周处理)
    if (old && old.e1rmKg >= e1rm - 0.5) {
      next[exerciseId] = { ...old, nameZh: old.nameZh || nameZh };
      continue;
    }
    next[exerciseId] = {
      exerciseId,
      nameZh,
      e1rmKg: e1rm,
      tmKg: round2(e1rm * MAX_FACTOR),
      source: 'auto',
      updatedAt: now
    };
  }
  return next;
}

/** 完成一次训练后刷新基准并落库 */
export function syncMaxesFromLogs(logs: WorkoutLog[]): MaxMap {
  const m = syncMaxes(logs);
  saveMaxes(m);
  return m;
}

/** 手动设定某动作的训练最大重量(直接填 TM,不是 1RM) */
export function setMax(exerciseId: string, nameZh: string, tmKg: number): MaxMap {
  // 助力器械没有「训练最大重量」可言 —— 那格数字是器械配置,填了也只能是误导
  if (isAssisted(exerciseId)) return loadMaxes();
  const m = { ...loadMaxes() };
  if (tmKg > 0) {
    m[exerciseId] = {
      exerciseId,
      nameZh,
      e1rmKg: round2(tmKg / MAX_FACTOR),
      tmKg: round2(tmKg),
      source: 'manual',
      updatedAt: new Date().toISOString()
    };
  } else {
    delete m[exerciseId];
  }
  saveMaxes(m);
  return m;
}

/**
 * 周期走满一轮时上调基准。
 * 仍标记为 auto —— 之后如果日志里出现更好的成绩,会被自然刷新;
 * 没有更好的成绩就保留这次上调的值。
 */
export function bumpMax(exerciseId: string, nameZh: string, deltaKg: number): MaxMap {
  const m = { ...loadMaxes() };
  const old = m[exerciseId];
  if (!old || deltaKg <= 0) return m;
  const tmKg = round2(old.tmKg + deltaKg);
  m[exerciseId] = {
    ...old,
    nameZh: nameZh || old.nameZh,
    tmKg,
    e1rmKg: round2(tmKg / MAX_FACTOR),
    source: 'auto',
    updatedAt: new Date().toISOString()
  };
  saveMaxes(m);
  return m;
}

export function clearMax(exerciseId: string): MaxMap {
  const m = { ...loadMaxes() };
  delete m[exerciseId];
  saveMaxes(m);
  return m;
}

export function tmOf(maxes: MaxMap, exerciseId: string): number | null {
  const e = maxes[exerciseId];
  return e && e.tmKg > 0 ? e.tmKg : null;
}

/** 按训练最大重量的百分比开重量(对齐步长,且不低于一个步长) */
export function pctOfTm(tmKg: number, pct: number, step = 2.5): number {
  return snapStep(tmKg * pct, step);
}

/** 当前重量占训练最大重量的百分比(没有基准或自重动作返回 null) */
export function pctOfWeight(weightKg: number | null, tmKg: number | null): number | null {
  if (weightKg == null || tmKg == null || tmKg <= 0) return null;
  return Math.round((weightKg / tmKg) * 100);
}

/** 基准卡片上的一句话 */
export function maxSummary(e: MaxEntry): string {
  return `估算 1RM ${round2(e.e1rmKg)}kg · 训练基准 ${round2(e.tmKg)}kg`;
}

/** 展示用:基准从大到小(重量大的通常是主项,排前面方便看) */
export function maxList(m: MaxMap): MaxEntry[] {
  return Object.values(m)
    .filter((e) => e.tmKg > 0)
    .sort((a, b) => b.tmKg - a.tmKg);
}
