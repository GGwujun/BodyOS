/**
 * 训练历史统计 — 打卡、纪录、动作曲线、掉力。
 *
 * 日志是「哪天练了什么」的原始记录,这一层负责把它翻成人能看的东西:
 * 这一年练了几天(热力图)、哪个动作练到什么程度了(PR)、
 * 这个动作最近是不是原地踏步(曲线)、同一重量下第几组开始掉(掉力)。
 *
 * 原则和渐进引擎一致:补录/修改过的日志(`manual`,记不准)和「这次不算进步」的
 * 日志(`noProg`)都不进 PR —— 不该被供起来当纪录,但打卡和容量统计照算(那天确实练了)。
 */
import { addDays, dayDiff, mondayOf, todayStr } from '../../utils/date';
import { isIsoDate, type DayNote, type DayNotes } from './daynote';
import { EFFORT_BANDS, avgRir, bandIndex, isHardSet } from './effort';
import { findExercise } from './generator';
import { isAssisted, liftE1rm, loadText } from './load';
import { round2 } from './onerm';
import { isSided, sideRepsLabel } from './sided';
import { holdSecOfSets, holdText } from './timed';
import { countsForProgress, didSet, entryCounts, type WorkoutLog } from './types';

/* ============ 训练记录(一天的流水) ============ */

export interface HistoryRow {
  date: string;
  /** 那天练了 */
  log: WorkoutLog | null;
  /** 那天没练,但请了假(见 daynote.ts)—— 训练记录里的空档得说得清 */
  note: DayNote | null;
}

/**
 * 训练记录页的那一串行:每一次训练,插上「这天没练、但有请假条」的日子,从近到远。
 *
 * 三条规则,都不是随手定的:
 * 1. **一天只出现一次**。有训练的日子请假条不另占一行 —— 那天练都练了,让训练自己说话
 *    (想改请假去日历/热力图那边,那是看「安排」的地方,这里是看「发生过什么」的地方)。
 * 2. **未来的请假条不出现**。请假是可以提前标的(出差前一晚把后面几天一起标了),
 *    但那还没发生 —— 记录页只说过去和今天。
 * 3. **同一天的顺序照旧**。日志本来就是最新的在前,而「稳定排序」不该被当成正确性假设
 *    (旧机型上的 JS 引擎未必稳定),所以显式带上下标做决胜。
 */
export function historyRows(logs: WorkoutLog[], notes: DayNotes, today = todayStr()): HistoryRow[] {
  const trained = new Set(logs.map((l) => l.date));
  const rows: HistoryRow[] = logs.map((l) => ({ date: l.date, log: l, note: null }));
  for (const [date, note] of Object.entries(notes)) {
    if (!note?.kind || !isIsoDate(date)) continue;
    if (trained.has(date) || date > today) continue;
    rows.push({ date, log: null, note });
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.date === b.r.date ? a.i - b.i : a.r.date < b.r.date ? 1 : -1))
    .map((x) => x.r);
}

/* ============ 打卡 ============ */

export interface DayStat {
  date: string;
  /** 实际完成的组数 */
  sets: number;
  reps: number;
  volumeKg: number;
  durationSec: number;
  exercises: number;
}

/** 同一天的多次训练合并成一条(一天练两回很正常) */
export function dayStats(logs: WorkoutLog[]): DayStat[] {
  const map = new Map<string, DayStat>();
  for (const log of logs) {
    const cur = map.get(log.date) ?? { date: log.date, sets: 0, reps: 0, volumeKg: 0, durationSec: 0, exercises: 0 };
    cur.sets += log.totalSets || countSets(log);
    cur.reps += log.totalReps || 0;
    cur.volumeKg += log.totalVolumeKg || 0;
    cur.durationSec += log.durationSec || 0;
    cur.exercises += log.entries.length;
    map.set(log.date, cur);
  }
  return [...map.values()]
    .map((d) => ({ ...d, volumeKg: Math.round(d.volumeKg * 10) / 10 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function countSets(log: WorkoutLog): number {
  return log.entries.reduce((n, e) => n + e.sets.length, 0);
}

/* ============ 热力图 ============ */

/**
 * 热力图的色阶按什么算。同一张格子图,换个口径看的是另一件事:
 * 组数看「练了几组」(次数够不够)、时长看「在馆里待了多久」(含休息与有氧)、
 * 容量看「一共搬了多少公斤」(同样 20 组,重量差一倍容量差一倍)。三个数每天都有,
 * 但它们**互相替代不了** —— 这正是要给开关的原因(见 `HEAT_METRICS`)。
 */
export type HeatMetric = 'sets' | 'minutes' | 'volume';

/** 一个色阶口径:从哪天取哪个数、四档的门槛、图例两端怎么念 */
export interface HeatMetricDef {
  k: HeatMetric;
  label: string;
  /** 从某天里取这个口径的数 */
  of: (d: DayStat) => number;
  /** 前三档的上界(第四档往上不封顶) */
  steps: [number, number, number];
  /** 图例两端的字 —— **必须带门槛的数字**,不然「少/多」是相对谁说的只有算法知道 */
  lo: string;
  hi: string;
}

/**
 * 三个口径的门槛都定在「一次训练大概多少」上,不是分位数:
 * 相对自己分位的话,一个刚起步的人每组都浅、一个老手每天都满格,格子图就答不了
 * 「这天算不算练了」—— 而那才是打卡热力图要回答的第一件事。
 * 但绝对数就得**说给用户听**,所以每个口径都带着 `lo`/`hi` 上到图例里(用户点开某天还能看到确切的数)。
 */
export const HEAT_METRICS: HeatMetricDef[] = [
  { k: 'sets', label: '组数', of: (d) => d.sets, steps: [3, 8, 15], lo: '≤3 组', hi: '16 组+' },
  { k: 'minutes', label: '时长', of: (d) => Math.round(d.durationSec / 60), steps: [15, 30, 60], lo: '≤15 分', hi: '60 分+' },
  /* 容量按公斤记,门槛取 2 / 5 / 10 吨:2 吨是随手练两下,5 吨是正经一课,10 吨是大课。
     重量天然因人而异 —— 所以它更该和图例里那两个数一起看,而不是凭颜色猜 */
  { k: 'volume', label: '容量', of: (d) => d.volumeKg, steps: [2000, 5000, 10000], lo: '≤2 吨', hi: '10 吨+' }
];

export interface HeatCell {
  date: string;
  /** 0 = 没练,1-4 = 由少到多 */
  level: number;
  /**
   * 这天到底练没练(和色阶口径**无关**)。
   * 换「时长」口径时,老记录没有 `durationSec` 是 0 —— 但那明明练了,
   * 不能因为换个开关就从「练过」变成「缺勤」(那几天按最浅的一档涂)。
   */
  trained: boolean;
  /** 当前口径下这天的数(点开面板、图例都用它) */
  value: number;
  sets: number;
}
export interface HeatWeek {
  /** 该周第一天的日期(周一) */
  start: string;
  cells: HeatCell[];
}
export interface Heatmap {
  weeks: HeatWeek[];
  totalDays: number;
  /** 连续打卡天数(今天或昨天为止还连着才算) */
  streak: number;
  longest: number;
}

/**
 * 数 → 色阶(四档)。默认口径是组数:3 组以内算「摸了一下」,16 组以上封顶。
 * 门槛按口径查表,见 `HEAT_METRICS` —— 别在页面里再写一套。
 */
export function levelOf(value: number, metric: HeatMetric = 'sets'): number {
  if (!(value > 0)) return 0;
  const [a, b, c] = metricDef(metric).steps;
  if (value <= a) return 1;
  if (value <= b) return 2;
  if (value <= c) return 3;
  return 4;
}

/** 口径定义(未知的 key 一律按组数 —— 老数据/老调用方不该炸) */
export function metricDef(metric: HeatMetric = 'sets'): HeatMetricDef {
  return HEAT_METRICS.find((m) => m.k === metric) ?? HEAT_METRICS[0];
}

/**
 * 年度热力图。`weeks` 是显示多少列(默认 26 周,半年,手机上正好一屏能横滑)。
 * `today` 传进来而不是内部取,是为了能测。
 */
export function heatmap(logs: WorkoutLog[], weeks = 26, today = todayStr(), metric: HeatMetric = 'sets'): Heatmap {
  const stats = new Map(dayStats(logs).map((d) => [d.date, d]));
  const of = metricDef(metric).of;
  const out: HeatWeek[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(mondayOf(today), -w * 7);
    const cells: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const day = stats.get(date);
      const sets = day?.sets ?? 0;
      const value = day ? of(day) : 0;
      /* 练过但换个口径取不到数(比如老记录没有时长)按最浅一档涂,不做成「缺勤」 */
      const level = sets <= 0 ? 0 : Math.max(1, levelOf(value, metric));
      // 未来的日子(本周还没到的那几天)不涂色,免得看着像「缺勤」
      cells.push({ date, level: date > today ? 0 : level, trained: sets > 0, value, sets });
    }
    out.push({ start, cells });
  }

  const days = [...stats.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && dayDiff(prev, d.date) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d.date;
  }
  // 今天还没练不算断;但超过一天没练就算断了
  let streak = 0;
  if (days.length) {
    const last = days[days.length - 1].date;
    const gap = dayDiff(last, today);
    if (gap <= 1) {
      let i = days.length - 1;
      run = 1;
      while (i > 0 && dayDiff(days[i - 1].date, days[i].date) === 1) { run++; i--; }
      streak = run;
    }
  }
  return { weeks: out, totalDays: days.length, streak, longest };
}

/* ============ 汇总 ============ */

export interface Summary {
  sessions: number;
  days: number;
  sets: number;
  reps: number;
  volumeKg: number;
  minutes: number;
  /**
   * 这段时间里一共撑了多久(秒)。计时型动作对 `reps` 的贡献是 0(见 types.ts),
   * 所以一次核心课会在「0 次」上显示得像个休息日 —— 这个数就是它的另一面。
   */
  holdSec: number;
}

/** 取 date >= from 的日志做汇总(from 为 null 则全部) */
export function summaryOf(logs: WorkoutLog[], from: string | null = null): Summary {
  const list = from ? logs.filter((l) => l.date >= from) : logs;
  const s: Summary = { sessions: list.length, days: 0, sets: 0, reps: 0, volumeKg: 0, minutes: 0, holdSec: 0 };
  const daySet = new Set<string>();
  for (const l of list) {
    daySet.add(l.date);
    s.sets += l.totalSets || countSets(l);
    s.reps += l.totalReps || 0;
    s.volumeKg += l.totalVolumeKg || 0;
    s.holdSec += holdSecOfSets((l.entries ?? []).flatMap((e) => e.sets));
    s.minutes += Math.round((l.durationSec || 0) / 60);
  }
  s.days = daySet.size;
  s.volumeKg = Math.round(s.volumeKg);
  return s;
}

/* ============ 练得多狠(自感强度) ============ */

/**
 * 这段时间的强度画像 —— 「练了多少」答的是量,这个答的是**狠**。
 *
 * 口径:**按组算,不按次算**。`WorkoutLog.avgRir` 是每次训练的平均(给练完那一刻看的),
 * 拿它再平均一遍,一次只评了一组的课会和一次评了三十组的课一样重 —— 一个人某天随手点了一下
 * 就能把整段时间的读数带偏。这里数的是**每一组**,那才是「我的组有多接近力竭」。
 *
 * 分母是**评过分的组**:没评的组不进任何比例。把没评的当成「不狠」会让改了这个习惯的人
 * 看到自己的强度忽然暴跌,而那只是他没打分(练习页的评分钮是可选的)。
 * 页面靠 `rated / sets` 说明「N 组里评了 M 组」,而不是替没评的那些猜一个数。
 */
export interface EffortStat {
  /** 这段时间做掉的组数(日志里只有真做了的组,见 types.didSet) */
  sets: number;
  /** 其中评过强度的组数 —— 下面每一个比例的分母 */
  rated: number;
  /** 评过的组里接近力竭的(RIR ≤ HARD_RIR,见 effort.ts) */
  hard: number;
  /** 有效组占比(0-100 的整数);一组都没评时 null */
  hardPct: number | null;
  /** 评过的组的平均 RIR;一组都没评时 null */
  avgRir: number | null;
  /** 五档各多少组,下标对应 EFFORT_BANDS(和评分色带同一份刻度) */
  bands: number[];
}

export function effortStat(logs: WorkoutLog[], from: string | null = null): EffortStat {
  const list = from ? logs.filter((l) => l.date >= from) : logs;
  const bands = EFFORT_BANDS.map(() => 0);
  const reads: number[] = [];
  let sets = 0;
  for (const l of list) {
    for (const e of l.entries ?? []) {
      for (const s of e.sets ?? []) {
        sets++;
        if (s.rir == null) continue;
        reads.push(s.rir);
        const bi = bandIndex(s.rir);
        if (bi >= 0) bands[bi]++;
      }
    }
  }
  const hard = reads.filter(isHardSet).length;
  return {
    sets,
    rated: reads.length,
    hard,
    hardPct: reads.length ? Math.round((hard / reads.length) * 100) : null,
    avgRir: avgRir(reads),
    bands
  };
}

/* ============ 个人纪录 ============ */

export interface PrEntry {
  exerciseId: string;
  nameZh: string;
  /** 最大重量(那组做了几次) */
  topKg: number;
  topReps: number;
  /** 最佳单组 1RM 估算 */
  bestE1rm: number;
  /** 单次最大容量(一个动作在一次训练里的总容量) */
  bestVolumeKg: number;
  /**
   * 单组最长保持(秒)。计时型的纪录就在这个数上 —— 一次 90 秒的平板支撑
   * 在 `topKg` / `bestE1rm` / `bestVolumeKg` 三个维度上全是 0(见 types.ts 的容量口径),
   * 只看那三个数的话,计时型动作**永远刷新不了任何纪录**。
   * 次数型的动作没有这个字段(恒为 0,不参与任何判断)。
   */
  bestHoldSec: number;
  date: string;
  /** 刷新了几次 */
  times: number;
}

/**
 * 每个动作的最好成绩。
 * 只认 `manual`(记不准)和 `noProg`(那次不算)之外的日志 —— **两个粒度都算**:
 * 整场不算的那天整个跳过,只标了「这个动作不算」的那一条也跳过(见 `entryCounts`);
 * e1RM 只取 ≤12 次的组(次数越多估算越飘)。
 */
export function personalRecords(logs: WorkoutLog[]): PrEntry[] {
  const map = new Map<string, PrEntry>();
  const clean = logs.filter(countsForProgress).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const log of clean) {
    for (const e of log.entries) {
      // 只标了「这个动作不算进步」的那一条:那次的数据是好的(组数容量照进曲线),
      // 但不能进纪录 —— 换了台器械举出的重量和平时那把秤不是一回事
      if (e.noProg) continue;
      // 助力器械不进纪录:它的「重量」是器械替你分担的力,数值越大越轻松 ——
      // 记成「最大 X kg」的话,人越练越弱,纪录反而越漂亮(连最大重量也不给)。
      if (isAssisted(e.exerciseId)) continue;
      let volume = 0;
      for (const s of e.sets) {
        if (s.weightKg != null && s.weightKg > 0) volume += s.weightKg * s.reps;
      }
      const cur = map.get(e.exerciseId) ?? {
        exerciseId: e.exerciseId, nameZh: e.nameZh,
        topKg: 0, topReps: 0, bestE1rm: 0, bestVolumeKg: 0, bestHoldSec: 0, date: log.date, times: 0
      };
      cur.nameZh = e.nameZh || cur.nameZh;
      const sided = isSided(e.exerciseId);
      for (const s of e.sets) {
        const w = s.weightKg ?? 0;
        const e1 = liftE1rm(e.exerciseId, s.reps, w, sided);
        if (e1 > cur.bestE1rm) { cur.bestE1rm = round2(e1); cur.date = log.date; }
        if (w > cur.topKg || (w === cur.topKg && s.reps > cur.topReps)) {
          cur.topKg = w; cur.topReps = s.reps; cur.date = log.date;
        }
        // 计时型的唯一纪录维度。次数型的组没有 `sec`,这里恒为 0,不会干扰上面几条。
        const sec = Math.round(s.sec ?? 0);
        if (sec > cur.bestHoldSec) { cur.bestHoldSec = sec; cur.date = log.date; }
      }
      if (volume > cur.bestVolumeKg) { cur.bestVolumeKg = Math.round(volume); cur.date = log.date; }
      map.set(e.exerciseId, cur);
    }
  }
  for (const e of map.values()) {
    e.times = clean.filter((l) => l.entries.some((x) => x.exerciseId === e.exerciseId)).length;
  }
  return [...map.values()]
    // 保持时长也算成绩 —— 只筛那三个「次数/重量」维度的话,计时型动作一个都进不来
    .filter((e) => e.bestE1rm > 0 || e.topKg > 0 || e.bestVolumeKg > 0 || e.bestHoldSec > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/* ============ 这一场里破纪录的动作 ============ */

/** 一个动作一场里的「成绩」:最好一组的 1RM 估算,和撑得最久的一组(秒)。 */
interface ExScore {
  e1: number;
  sec: number;
}

const scoreOf = (exerciseId: string, sets: WorkoutLog['entries'][number]['sets']): ExScore => {
  const sided = isSided(exerciseId);
  let e1 = 0;
  let sec = 0;
  for (const s of sets) {
    if (!didSet(s)) continue;
    e1 = Math.max(e1, liftE1rm(exerciseId, s.reps, s.weightKg ?? 0, sided));
    sec = Math.max(sec, Math.round(s.sec ?? 0));
  }
  return { e1: round2(e1), sec };
};

/** a 严格好过 b:配重动作比 1RM;两边都没有 1RM(计时型/自重)才轮到秒数 */
const beats = (a: ExScore, b: ExScore): boolean =>
  a.e1 > 0 ? a.e1 > b.e1 : b.e1 === 0 && a.sec > b.sec;

/**
 * 一场训练里哪些动作「这次破了自己的纪录」。
 *
 * 不存进日志、每次展开现算(和 `bestOf`/`personalRecords` 一样是派生量):判定口径以后
 * 要是调整(比如助力器械再排除掉一类),老记录上的徽标跟着改,不用迁移数据。
 * 「之前」按**日期**比(比这场早的、以及同一天的别的场),不看那条日志是什么时候录入的 ——
 * 补录一场更早且更好的成绩,今天这场就不再算纪录,这才是「破纪录」本来的意思。
 *
 * 门和别处同一套:整场补录/「不算进步」的那场拿不到徽标(它自己就说了不算),
 * 之前的历史里那些场同样不进「之前的最好」。第一次练某个动作不算 —— 没有纪录可破。
 */
export function prsOfLog(log: WorkoutLog, logs: WorkoutLog[]): string[] {
  if (!countsForProgress(log)) return [];
  // 之前(按日期)每个动作的最好成绩,以及「之前真的练过它」—— 没练过就没有纪录可破
  const prior = new Map<string, { score: ExScore; seen: boolean }>();
  for (const other of logs) {
    if (other.id === log.id || other.date > log.date) continue;
    if (!countsForProgress(other)) continue;
    for (const e of other.entries) {
      if (e.noProg) continue;
      const cur = prior.get(e.exerciseId);
      const score = scoreOf(e.exerciseId, e.sets);
      prior.set(e.exerciseId, {
        score: cur ? (beats(score, cur.score) ? score : cur.score) : score,
        seen: true
      });
    }
  }
  const out: string[] = [];
  for (const e of log.entries) {
    if (e.noProg) continue;
    const before = prior.get(e.exerciseId);
    if (!before?.seen) continue;   // 第一次练:再重也是「第一次」,不是「破纪录」
    if (beats(scoreOf(e.exerciseId, e.sets), before.score)) out.push(e.exerciseId);
  }
  return out;
}

/* ============ 一组旁边的「上次 / 最好」 ============ */

export interface RefLine {
  /** 上次练它是哪天(没有则 null) */
  date: string | null;
  /** 上次那天练的每一组,顺序即组序(空 = 没练过) */
  lastTexts: string[];
  /** 至今最好的那一组一句话;没有可用纪录为 null */
  bestText: string | null;
}

/** 一组 → 一句话。「60×8」/「保持 45 秒」—— 单侧动作走 `sideRepsLabel`,折两侧只此一处 */
export const setText = (exerciseId: string, s: { weightKg?: number | null; reps: number; sec?: number | null }): string => {
  const sec = Math.round(s.sec ?? 0);
  if (sec > 0) return `保持 ${holdText(sec)}`;
  const reps = sideRepsLabel(exerciseId, s.reps);
  const w = s.weightKg;
  return w != null && w > 0 ? `${loadText(exerciseId, w)}×${reps}` : `${reps} 次`;
};

/** 「3 天前」/「昨天」/「今天」—— 隔了多久是参照的一半信息(隔太久的「上次」不该照着做) */
function agoText(date: string, today = todayStr()): string {
  const d = dayDiff(date, today);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  return `${d} 天前`;
}

/** 一个动作「至今最好的一组」的四个候选量(取哪一个是 `bestTextOf` 的事) */
interface BestPick {
  /** 最重的那组:重量 + 那组做了几次 */
  kg: number;
  reps: number;
  /** 做得最多的那组 —— 自重动作唯一说得出的量 */
  maxReps: number;
  sec: number;
}

/**
 * 扫一遍日志,把每个动作「至今最好的一组」挑出来(一批日志一次算完,不是每个动作各扫一遍)。
 *
 * 挡在门外的三类,和别处**判成绩**的两道门是同一套(见 `countsForProgress` / `entryCounts`):
 * 整场不算的、只标了这个动作不算的、补录(记不准)的。跳过没做的组(`didSet`)。
 *
 * 助力器械的「重量」是器械替你分担的力,越大越轻松 —— 记成「最好」会越练越漂亮,
 * 所以它的重量按 0 记,最后落进「做了几次」那一档(和 `personalRecords` 同一个理由)。
 */
function scanBest(logs: WorkoutLog[]): Map<string, BestPick> {
  const map = new Map<string, BestPick>();
  for (const log of logs) {
    if (!countsForProgress(log)) continue;
    for (const e of log.entries) {
      if (e.noProg) continue;
      const assisted = isAssisted(e.exerciseId);
      const cur = map.get(e.exerciseId) ?? { kg: 0, reps: 0, maxReps: 0, sec: 0 };
      for (const s of e.sets) {
        if (!didSet(s)) continue;
        const sec = Math.round(s.sec ?? 0);
        if (sec > cur.sec) cur.sec = sec;
        const w = assisted ? 0 : (s.weightKg ?? 0);
        if (w > cur.kg || (w === cur.kg && s.reps > cur.reps)) { cur.kg = w; cur.reps = s.reps; }
        if (s.reps > cur.maxReps) cur.maxReps = s.reps;
      }
      map.set(e.exerciseId, cur);
    }
  }
  return map;
}

/**
 * 最好的一组 → 一句话(「65kg×6」/「保持 1 分 30 秒」/「每侧 10 次」);一个数都没有就 null。
 *
 * 三个量纲取**一个**说,顺序是有讲究的:计时型先看秒(它的组次数恒为 0,按次数念会念成
 * 「0 次」),有配重的看重量,剩下来的自重动作才轮到次数。三者是并列的三个「最好」,
 * 拼成「60kg×8 / 保持 90 秒 / 20 次」那种一句话反而没人读得懂。
 */
function bestTextOf(exerciseId: string, p: BestPick): string | null {
  if (p.sec > 0) return `保持 ${holdText(p.sec)}`;
  if (p.kg > 0) return `${loadText(exerciseId, p.kg)}×${sideRepsLabel(exerciseId, p.reps)}`;
  if (p.maxReps > 0) return `${sideRepsLabel(exerciseId, p.maxReps)} 次`;
  return null;
}

/**
 * 每个动作「至今最好的一组」那句话 —— 动作库的列表一行用它(「练过 12 次 · 最好 65kg×6」)。
 * 练过的动作才在这张表里,没练过的**没有键**(列表上不要多一个「最好 —」)。
 */
export type BestMap = Record<string, string>;

export function bestOf(logs: WorkoutLog[]): BestMap {
  const out: BestMap = {};
  for (const [id, p] of scanBest(logs)) {
    const t = bestTextOf(id, p);
    if (t) out[id] = t;
  }
  return out;
}

/**
 * 练到某一行时最想知道的两件事:**上次这个动作练成什么样**、**至今最好的一组是多少**。
 * 这两件事本来只在历史面板里,而练的时候退出去翻一眼就是断节奏(见 M11 ⑦)。
 *
 * 两条口径:
 *  - **上次**取「最近一次练过它的日志」,连 `manual`(补录)也算 —— 补录的那次确实练了,
 *    只是记晚了(和 `strength.ts` 的「上次练」同一条理由)。这里**不看** `noProg`:
 *    那一天的状态差不代表那天的重量不是他上次举起来的。
 *  - **最好**只看算得上成绩的那些(整场不算的不看、这个动作标了不算的也不看,
 *    见 `entryCounts`;补录那次记不准,同样不该被供成纪录)—— 就是 `bestOf` 那一份,
 *    这样「练的时候看见的最好」和「挑动作时列表上写的最好」永远是同一个数。
 *    这里**不**复用 `personalRecords`:那张表的过滤条件是「够得上纪录榜的维度」
 *    (重量/1RM/容量/保持),自重动作在它那儿一条都进不来 —— 而参照行里自重动作
 *    (引体向上、俯卧撑)恰恰最需要第二个人数对照,不能一个都留不下。
 */
export function refLine(logs: WorkoutLog[], exerciseId: string, today = todayStr()): RefLine {
  const out: RefLine = { date: null, lastTexts: [], bestText: null };

  // ---- 上次:最近一次**真练了它**的那天 ----
  // 一组都没做过的那次不算「上次」:那天只是把它排进了课表,没有发生可对照的事
  // (判据就是 `didSet`,和别处同一个)。
  // 一天练两回则取**那天组数多的那一场**:问的是那天真练的那一场,而不是第二场里补的两组
  // (日志按日期倒序,同一天里两场的先后不保证,得自己挑)。
  const hits = logs
    .map((l) => ({ date: l.date, entry: l.entries?.find((e) => e.exerciseId === exerciseId) }))
    .filter((h): h is { date: string; entry: WorkoutLog['entries'][number] } =>
      !!h.entry && h.entry.sets.some(didSet));
  if (hits.length) {
    const latest = hits.reduce((a, b) => (b.date > a.date ? b : a));
    // `>=` 留着:同一天里两场组数一样时取靠后的那条,免得同一份数据两次打开显示不同的场次
    const pick = hits.filter((h) => h.date === latest.date)
      .reduce((a, b) => (b.entry.sets.filter(didSet).length >= a.entry.sets.filter(didSet).length ? b : a));
    out.date = pick.date;
    out.lastTexts = pick.entry.sets.filter((s) => didSet(s)).map((s) => setText(exerciseId, s));
  }

  // ---- 最好:重量最高的一组;计时型看撑得最久的;都没有(自重)就看次数最多的一组 ----
  // 口径在 `bestOf` 里(它还要供动作库的列表用),这里只是取这个动作那一句
  out.bestText = bestOf(logs)[exerciseId] ?? null;
  return out;
}

/** 参照行那句话 —— 「上次 3 天前 · 60kg×8 / 60kg×8 / 57.5kg×6 · 最好 65kg×6」。没东西可说返回 null。 */
export function refText(ref: RefLine, today = todayStr()): string | null {
  const bits: string[] = [];
  if (ref.date && ref.lastTexts.length) bits.push(`上次 ${agoText(ref.date, today)} · ${ref.lastTexts.join(' / ')}`);
  if (ref.bestText) bits.push(`最好 ${ref.bestText}`);
  return bits.length ? bits.join(' · ') : null;
}

/* ============ 单个动作的曲线 ============ */

export interface ExercisePoint {
  date: string;
  /** 当天最重的一组 */
  topKg: number;
  reps: number;
  /** 该动作当天的总容量 */
  volumeKg: number;
  sets: number;
  bestE1rm: number;
  /**
   * 当天**最长那组**的秒数(计时型动作的曲线就画它)。次数型恒为 0 ——
   * 那一列全是 0,页面按这个值决定画时长曲线还是次数曲线,不会画出一条贴着横轴的线。
   */
  holdSec: number;
  /**
   * 当天该动作**所有计时组**的秒数合计 —— 「这次一共撑了多久」。
   * `holdSec` 说的是最硬的那一组,这个是整节课的量;次数型恒为 0。
   */
  holdTotalSec: number;
  /** 该动作当天的平均 RIR(评过分的组) */
  avgRir: number | null;
}

export function exerciseHistory(logs: WorkoutLog[], exerciseId: string): ExercisePoint[] {
  const map = new Map<string, ExercisePoint>();
  const sided = isSided(exerciseId);
  for (const log of logs) {
    for (const e of log.entries) {
      if (e.exerciseId !== exerciseId) continue;
      const cur = map.get(log.date) ?? {
        date: log.date, topKg: 0, reps: 0, volumeKg: 0, sets: 0, bestE1rm: 0,
        holdSec: 0, holdTotalSec: 0, avgRir: null
      };
      let rirSum = 0;
      let rirN = 0;
      for (const s of e.sets) {
        const w = s.weightKg ?? 0;
        cur.sets++;
        if (w > cur.topKg) { cur.topKg = w; cur.reps = s.reps; }
        else if (w === cur.topKg && s.reps > cur.reps) cur.reps = s.reps;
        cur.volumeKg += w * s.reps;
        // 助力动作的 1RM 恒为 0(见 load.liftE1rm)—— 曲线留着看次数,但不出 1RM 那条线
        cur.bestE1rm = Math.max(cur.bestE1rm, liftE1rm(exerciseId, s.reps, w, sided));
        const sec = Math.round(s.sec ?? 0);
        cur.holdSec = Math.max(cur.holdSec, sec);
        cur.holdTotalSec += sec;
        if (s.rir != null) { rirSum += s.rir; rirN++; }
      }
      if (rirN) cur.avgRir = Math.round((rirSum / rirN) * 10) / 10;
      cur.volumeKg = Math.round(cur.volumeKg);
      cur.bestE1rm = round2(cur.bestE1rm);
      map.set(log.date, cur);
    }
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 只留练过 >= 2 次的日志(只有一次看不出趋势) */
export function hasTrend(points: ExercisePoint[]): boolean {
  return points.length >= 2;
}

/* ============ 每组掉力 ============ */

/**
 * 掉力的两条线:10% 以内算正常(说明这个重量/时长选对了),
 * 25% 以上算「对当天状态太狠」。单次判据和跨次判据共用这两个刻度 ——
 * 各写各的数字,迟早会出现「这一页说正常、那一页说偏重」。
 */
const DROP_OK = 10;
const DROP_HEAVY = 25;

export interface SetDrop {
  /** 第几组(从 1 开始) */
  index: number;
  weightKg: number;
  reps: number;
  /** 相对第一组的掉幅(%),第一组为 0 */
  dropPct: number;
}
export interface DropAnalysis {
  sets: SetDrop[];
  /** 末组相对首组掉了多少 %(负数=反而多做了) */
  lastDropPct: number;
  /** 只取重量相同的那几组分析:减重了就不是掉力,是主动降重 */
  uniform: boolean;
  verdict: string;
}

/**
 * 同一重量下的掉力。掉 10% 以内是正常范围(说明重量合适),
 * 掉 30% 以上说明这重量对当前状态太重了。
 */
export function dropOff(sets: { reps: number; weightKg: number | null }[]): DropAnalysis {
  const withW = sets.filter((s) => s.weightKg != null && s.weightKg > 0);
  const first = withW[0]?.weightKg ?? 0;
  const uniform = withW.length >= 2 && withW.every((s) => s.weightKg === first);
  const rows: SetDrop[] = withW.map((s, i) => ({
    index: i + 1,
    weightKg: s.weightKg as number,
    reps: s.reps,
    dropPct: i === 0 || !withW[0].reps ? 0 : Math.round(((withW[0].reps - s.reps) / withW[0].reps) * 100)
  }));
  const last = rows.length ? rows[rows.length - 1].dropPct : 0;
  return {
    sets: rows,
    lastDropPct: last,
    uniform,
    verdict: dropVerdict(rows, uniform)
  };
}

function dropVerdict(rows: SetDrop[], uniform: boolean): string {
  if (rows.length < 2) return '只有一组,看不出掉力。多练几组才有意义 —— 最后一组掉多少,才是这重量合不合适的真实反馈。';
  if (!uniform) return '这几组重量不一样(可能是主动降重或金字塔),掉力算法对它不适用,看次数就够了。';
  const last = rows[rows.length - 1].dropPct;
  if (last <= 0) return '末组比首组做得还多,说明前面留了力气 —— 下一轮首组可以再加一点重量。';
  if (last <= DROP_OK) return `掉幅在 ${DROP_OK}% 以内,重量选得刚好,保持这个思路。`;
  if (last <= DROP_HEAVY) return `末组掉了 ${last}%,略多。这重量偏重,或者组间休息短了 —— 先加 30 秒休息看看。`;
  return `末组掉了 ${last}%,掉得有点狠。这个重量对今天的状态太重,建议降一档再练。`;
}

/** 一组都没重量(纯自重)时给个替代说法 */
export function dropHint(sets: { reps: number; weightKg: number | null }[]): string | null {
  return sets.every((s) => s.weightKg == null) ? '自重动作看次数就行 —— 掉力主要用来判断「重量有没有选大」。' : null;
}

export interface HoldBar {
  /** 第几组(从 1 开始) */
  index: number;
  sec: number;
  /** 相对第一组的掉幅(%),第一组为 0 */
  dropPct: number;
}
export interface HoldAnalysis {
  bars: HoldBar[];
  /** 末组相对首组掉了多少 %(负数=反而撑得更久) */
  lastDropPct: number;
  verdict: string;
}

/**
 * 计时型的掉力:每组**撑住的秒数**在往下掉。
 *
 * 复用不了 `dropOff` —— 那个看的是次数,而计时组的 `reps` 恒为 0(见 types.ts),
 * 平板支撑的每一组在它眼里都是「0 次」:先是全部重量为 null 被 `dropHint` 当成自重动作,
 * 再是首组次数为 0 使得每一组的掉幅都算成 0,最后给一个撑得越来越短的人发一句
 * 「末组比首组做得还多,说明前面留了力气」。两个量纲不同,判据就得分开写。
 *
 * 也不再按「重量是否一致」挑组:计时组之间本来就该同长,不用像加减重那样先筛一遍。
 */
export function holdDrop(sets: { sec?: number; weightKg: number | null }[]): HoldAnalysis {
  const secs = sets.map((s) => Math.max(0, Math.round(s.sec ?? 0)));
  const first = secs[0] ?? 0;
  const bars: HoldBar[] = secs.map((sec, i) => ({
    index: i + 1,
    sec,
    dropPct: i === 0 || !first ? 0 : Math.round(((first - sec) / first) * 100)
  }));
  const last = bars.length ? bars[bars.length - 1].dropPct : 0;
  return { bars, lastDropPct: last, verdict: holdVerdict(bars) };
}

function holdVerdict(bars: HoldBar[]): string {
  if (bars.length < 2) return '只有一组,看不出掉力。多撑几组才知道第一组该留多少力气。';
  if (bars.some((b) => b.sec <= 0)) {
    return '有一组没记时长,这次先不算掉力 —— 掉幅是要每一组都记下秒数才看得出来。';
  }
  const last = bars[bars.length - 1].dropPct;
  if (last <= 0) return '末组比首组撑得还久,说明前面留了力气 —— 下一轮第一组可以再撑久一点。';
  if (last <= DROP_OK) return `掉幅在 ${DROP_OK}% 以内,说明第一组选的时长是能连撑下来的。`;
  if (last <= DROP_HEAVY) return `末组掉了 ${last}%,略多。组间休息可以再长 30 秒,或者每组先降一档时长。`;
  return `末组掉了 ${last}%,掉得有点狠。这个时长对今天的状态太长,先按第一组能撑住的七成来练。`;
}

/* ============ 掉力的跨次趋势 ============ */

export interface DropSample {
  date: string;
  /** 那次练的重量;计时型没有这一说,恒为 null */
  weightKg: number | null;
  /** 那次末组相对首组的掉幅(%) */
  lastDropPct: number;
}

/**
 * 把「这个动作练过的每一次」筛成**能算掉力的那几次**,近 → 远。
 *
 * 筛的理由和单次分析一样,只是搬到了跨次上:金字塔组(每组都在减重)掉的是重量不是力气,
 * 计时组缺秒数就算不出掉幅 —— 这两种如果混进采样,平均掉幅会被稀释成一个既不像 A
 * 也不像 B 的数,最后给出一句对不上任何一次训练的结论。
 *
 * 取不够 limit 次也有多少算多少:新人刚练三次,那三次就是他的全部历史。
 *
 * 同一次训练里同一个动作练了两块(中途加练过一回),只看第一块 —— 掉力问的是
 * 「连着两组之间掉了几次」,中间隔着别的动作的那两块不该接成一条掉力曲线。
 */
export function dropSamples(
  logs: WorkoutLog[],
  exerciseId: string,
  mode: 'reps' | 'sec',
  limit = 5
): DropSample[] {
  const out: DropSample[] = [];
  // 近的在前 —— 采样的意义在于「最近怎么样」,先到先得
  const ord = [...logs].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const log of ord) {
    if (out.length >= limit) break;
    const e = log.entries.find((x) => x.exerciseId === exerciseId);
    if (!e || e.sets.length < 2) continue;
    if (mode === 'sec') {
      if (e.sets.some((s) => Math.round(s.sec ?? 0) <= 0)) continue;
      out.push({ date: log.date, weightKg: null, lastDropPct: holdDrop(e.sets).lastDropPct });
    } else {
      const d = dropOff(e.sets);
      if (!d.uniform) continue;
      out.push({ date: log.date, weightKg: d.sets[0].weightKg, lastDropPct: d.lastDropPct });
    }
  }
  return out;
}

export interface DropTrend {
  /** 采样的那几次,近 → 远 */
  samples: DropSample[];
  /** 末组掉幅的平均(%) —— 负数表示平均下来末组比首组还多 */
  avgPct: number;
  /** 最近一次掉了多少 */
  latestPct: number;
  /** 除最近一次之外的平均;只有一次采样时是 null */
  priorAvgPct: number | null;
  verdict: string;
}

/**
 * 跨次看掉力 —— 「这一次掉得多」和「每次都掉得多」是两回事,处置也相反:
 * 前者别动重量(动了就是把一个状态不好的一天当成长期结论),后者必须动。
 * 单次分析那张卡只会说后者的话,因为它只看得到一次。
 *
 * 少于三次不给结论:两次凑不出趋势,而这两次各自的掉幅,单次那张卡已经说过了 ——
 * 再说一遍只是在同一个数上叠一句话。
 */
export function dropTrend(samples: DropSample[]): DropTrend | null {
  if (samples.length < 3) return null;
  const pcts = samples.map((s) => s.lastDropPct);
  const avgPct = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  const latestPct = pcts[0];
  const prior = pcts.slice(1);
  const priorAvgPct = prior.length
    ? Math.round(prior.reduce((a, b) => a + b, 0) / prior.length)
    : null;
  return {
    samples,
    avgPct,
    latestPct,
    priorAvgPct,
    verdict: trendVerdict(pcts, avgPct, latestPct, priorAvgPct)
  };
}

function trendVerdict(
  pcts: number[],
  avgPct: number,
  latestPct: number,
  priorAvgPct: number | null
): string {
  const n = pcts.length;
  if (avgPct <= 0) return `最近 ${n} 次末组都不比首组少,力气还有富余 —— 首组可以再加一点。`;
  if (avgPct <= DROP_OK) {
    return `最近 ${n} 次末组平均只掉 ${avgPct}%,这个重量稳得住 —— 想涨就从首组加一点开始。`;
  }
  // 平均掉得多,但这一次明显比之前都狠 —— 更像一天的状态,不是重量的事
  if (latestPct > DROP_HEAVY && priorAvgPct != null && priorAvgPct <= DROP_OK) {
    return `最近一次掉了 ${latestPct}%,但之前几次平均只掉 ${priorAvgPct}% —— `
      + '更像是那天状态不对(睡不够、没吃够、休息短),先别急着降重量。';
  }
  const over = pcts.filter((p) => p > DROP_OK).length;
  if (over * 2 > n) {
    return `最近 ${n} 次末组平均掉 ${avgPct}%,而且是一次次掉出来的 —— 不是偶然,`
      + '这个重量偏重(或者组间休息短了)。先加 30 秒休息,还这样就把首组降一档。';
  }
  return `最近 ${n} 次末组平均掉 ${avgPct}%,忽高忽低 —— 重量本身还行,`
    + '先把组间休息固定下来再看几周。';
}

/* ============ 动作名 ============ */

/** 日志里记的中文名优先,没有就查库,再没有就显示 id */
export function nameOf(logs: WorkoutLog[], exerciseId: string): string {
  for (const l of logs) {
    const hit = l.entries.find((e) => e.exerciseId === exerciseId);
    if (hit?.nameZh) return hit.nameZh;
  }
  return findExercise(exerciseId)?.nameZh ?? exerciseId;
}
