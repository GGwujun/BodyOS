/**
 * 力量保持 —— 每个动作自己的成绩衰减。
 *
 * 为什么不能靠已有的肌群恢复模型:恢复看的是「这块肌肉最近有没有被练到」,
 * 它答不了「我的卧推还行不行」。停练两个月但一直在做俯卧撑,胸是「已经恢复」的,
 * 卧推的成绩却实实在在掉了 —— 被练到的是肌肉,退掉的是这一个动作的成绩。
 * 所以这个模块只看**这一个动作**上一次是什么时候练的。
 *
 * 曲线(「用进废退」的经验值,不假装是实验数据):
 *   停练 ≤ 14 天 → 100%(动作技能与神经适应的短期记忆,两周内基本不掉)
 *   之后每 28 天 → 掉一半(指数衰减)
 *   最低 50%    → 再往下算就是编数字了,练过的人不会归零
 *
 * 给出的是**「按你历史最好的成绩,今天大概还剩多少」**,不是精确值 ——
 * 一直保持训练的动作一律记 100%(没有理由假设他退步了),停久了才打折。
 *
 * 口径:
 *  - 「成绩」只认能拿来判断进步的日志(补录的 `manual`、以及标了「这次不算」的 `noProg`
 *    都不算 —— **整场**和**单个动作**两个粒度都算上)且次数 ≤ 12 ——
 *    和 PR / 力量基准同一套,规则本身在 `types.entryCounts`。
 *    助力器械没有成绩(见 load.ts):数字越大越轻松,列在这里只会「越退步越强壮」。
 *  - 「上次练」算上补录的日志:补的是一次真练过的训练,它确实发生了,只是记晚了。
 *  - 热身组不存在这个区别:BodyOS 的热身只打勾、不落日志,日志里每一组都是正式组。
 */
import { dayDiff, todayStr } from '../../utils/date';
import { liftE1rm } from './load';
import { isSided } from './sided';
import { entryCounts, type WorkoutLog } from './types';

/** 停练这个天数以内不掉(默认值,调用方可以覆盖) */
export const PLATEAU_DAYS = 14;
/** 平台期之后,每这么多天掉一半 */
export const HALF_LIFE_DAYS = 28;
/** 掉到这个比例就不再往下算 */
export const FLOOR = 0.5;
/** 估算成绩时超过这个次数的组不算(次数越多外推越飘) */
const EST_MAX_REPS = 12;

export interface StrengthRow {
  exerciseId: string;
  nameZh: string;
  /** 历史最好成绩(估算 1RM,kg) */
  bestE1rm: number;
  /** 那个成绩是哪天做出来的 */
  bestDate: string;
  /** 最后一次练这个动作(含补录) */
  lastDate: string;
  /** 停练了几天(今天练过就是 0) */
  restDays: number;
  /** 还剩几成(0.5 - 1) */
  retained: number;
  /** 今天的预估成绩 = 最好成绩 × 保持率 */
  currentE1rm: number;
  /** 掉了多少公斤 */
  lostKg: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 停练 `days` 天之后还剩几成。
 * 负数(日志日期比今天还晚,理论上不该出现)按 0 天算。
 */
export function retainedAt(days: number, plateau = PLATEAU_DAYS, halfLife = HALF_LIFE_DAYS): number {
  if (!Number.isFinite(days) || days <= plateau) return 1;   // 含 NaN:读不懂就当没掉
  const over = days - plateau;
  if (!(halfLife > 0)) return 1;
  return Math.max(FLOOR, Math.pow(0.5, over / halfLife));
}

/**
 * 每个动作一行。**只有攒下过成绩的动作才在列表里** ——
 * 没有可用成绩的动作(纯自重、或还没练过几次)宁可不出现在这里,也不编一个数。
 */
export function strengthRows(logs: WorkoutLog[], today = todayStr()): StrengthRow[] {
  interface Acc { nameZh: string; bestE1rm: number; bestDate: string; lastDate: string }
  const map = new Map<string, Acc>();

  for (const log of logs) {
    if (!log?.date || !Array.isArray(log.entries)) continue;
    for (const e of log.entries) {
      if (!e?.exerciseId) continue;
      const cur = map.get(e.exerciseId) ?? {
        nameZh: e.nameZh || e.exerciseId, bestE1rm: 0, bestDate: log.date, lastDate: log.date
      };
      cur.nameZh = e.nameZh || cur.nameZh;
      if (log.date > cur.lastDate) cur.lastDate = log.date;   // 补录的也算一次真练
      // 成绩要两个粒度都不算:整场不算的跳过,只标了这个动作不算的也跳过
      // (「上次练」在上面那一行就更新过了 —— 那天确实练了,这是有意分开的两件事)
      if (entryCounts(log, e)) {
        for (const s of e.sets ?? []) {
          // 次数上限、单侧折算与助力排除都在 liftE1rm 里(单侧动作存的是两侧合计)
          const e1 = liftE1rm(e.exerciseId, s?.reps ?? 0, s?.weightKg, isSided(e.exerciseId), EST_MAX_REPS);
          if (e1 > cur.bestE1rm) { cur.bestE1rm = e1; cur.bestDate = log.date; }
        }
      }
      map.set(e.exerciseId, cur);
    }
  }

  const rows: StrengthRow[] = [];
  for (const [exerciseId, a] of map) {
    if (!(a.bestE1rm > 0)) continue;
    const restDays = Math.max(0, dayDiff(a.lastDate, today));
    const retained = retainedAt(restDays);
    const currentE1rm = round1(a.bestE1rm * retained);
    rows.push({
      exerciseId,
      nameZh: a.nameZh,
      bestE1rm: round1(a.bestE1rm),
      bestDate: a.bestDate,
      lastDate: a.lastDate,
      restDays,
      retained,
      currentE1rm,
      lostKg: round1(a.bestE1rm - currentE1rm)
    });
  }
  // 预估成绩从高到低 —— 先看主项
  return rows.sort((x, y) => y.currentE1rm - x.currentE1rm || (x.nameZh < y.nameZh ? -1 : 1));
}

/** 单个动作那一行(没有可用成绩就是 null) */
export function strengthOf(logs: WorkoutLog[], exerciseId: string, today = todayStr()): StrengthRow | null {
  return strengthRows(logs, today).find((r) => r.exerciseId === exerciseId) ?? null;
}

/**
 * 掉了的动作 —— 只留真的停过(超过平台期)且掉了半公斤以上的,掉得多的排前面。
 * 半公斤以下当舍入误差,不值得让用户看一眼。
 */
export function fadedRows(rows: StrengthRow[], minLostKg = 0.5): StrengthRow[] {
  return rows
    .filter((r) => r.retained < 1 && r.lostKg >= minLostKg)
    .sort((a, b) => b.lostKg - a.lostKg);
}

/** 停练多久的人话:「今天练过」/「停练 3 天」/「停练 6 周」/「停练 5 个月」 */
export function restText(days: number): string {
  const d = Math.max(0, Math.round(days));
  if (d === 0) return '今天练过';
  if (d === 1) return '昨天练过';
  if (d < 14) return `停练 ${d} 天`;
  if (d < 60) return `停练 ${Math.round(d / 7)} 周`;
  return `停练 ${Math.round(d / 30)} 个月`;
}

/** 保持率的人话:95% 以上就别渲染这一段了(调用方用 keptText 判断) */
export function retainedText(row: StrengthRow): string {
  return `${restText(row.restDays)} · 力量约剩 ${Math.round(row.retained * 100)}%`;
}

/** 已经掉了一截(值得在界面上说一句) */
export function isFaded(row: StrengthRow): boolean {
  return row.retained < 0.95;
}

/** 成绩那一格的补充说明:「保持住了」/「停练 6 周,约剩 80%」 */
export function keptText(row: StrengthRow): string {
  if (!isFaded(row)) return '保持住了';
  return `${restText(row.restDays)},约剩 ${Math.round(row.retained * 100)}%`;
}

/** 整个列表的一句话总结(没有掉的就返回 null,让调用方别渲染) */
export function fadedVerdict(rows: StrengthRow[]): string | null {
  const faded = fadedRows(rows);
  if (!faded.length) return null;
  const worst = faded[0];
  if (faded.length === 1) {
    return `只有「${worst.nameZh}」掉了 —— ${restText(worst.restDays)},大约从 ${worst.bestE1rm}kg 退到 ${worst.currentE1rm}kg。`;
  }
  return `${faded.length} 个动作因为停练久了有下降,最明显的是「${worst.nameZh}」(${restText(worst.restDays)},约 ${worst.bestE1rm}kg → ${worst.currentE1rm}kg)。`;
}
