/**
 * 渐进引擎 — 用一次训练的实际完成情况推导下次目标。
 * 四种次数规则:
 *  linear  线性加重(杠铃/器械):全部组达到目标次数 → 下次 +step
 *           —— **助力器械(助力引体向上这类)不走线性**:它的「重量」是器械帮你的力,
 *           加重量等于把动作变轻松。这类动作一律按 ladder 走,到顶后往**减少助力**的方向调。
 *  double  双渐进(哑铃/壶铃):先把每组次数推到区间上限 → 再加重回落
 *  ladder  次数阶梯(徒手/弹力带):达到上限后目标次数 +2;连续达标推荐更难变式
 *  triple  三阶渐进:次数推满 → 组数加满 → 加重回到起点(想练扎实的人)
 * 第五种是**时长阶梯**(见 progressHold):计时型的动作没有次数可推,推的是秒数 ——
 * 撑到处方上限就 +5 秒,连续 2 次没撑到就回退 5 秒(下限 10 秒);到封顶秒数之后,
 * 有配重的加重(农夫行走),没配重的换更难的变式(平板支撑)。
 * 它和上面四条**分开走**(progressOne 开头那一处分支就返回了):秒和次数不是同一个量,
 * 硬套次数规则会让 repsMax 从 0 一路加到 4,用户会看见一个「目标 4 次」的平板支撑。
 * 连续 2 次未达标 → 减载 10%(负重)或目标回退(徒手),这是防挫败的安全网。
 * 走周期波次的动作(cycleLocked)不走这套 —— 它的重量次数由 %训练最大重量 处方定,
 * 两边同时改重量会打架(见 cycle.ts)。
 */
import { EXERCISES } from '../data/exercises';
import { todayStr } from '../../utils/date';
import { findExercise } from './generator';
import { isAssisted } from './load';
import { round2 } from './onerm';
import { avgRir } from './effort';
import { sideRepsText } from './sided';
import {
  HOLD_DEFAULT_SEC, HOLD_PROGRESS_BACK_SEC, HOLD_PROGRESS_CAP_SEC, HOLD_PROGRESS_STEP_SEC,
  holdRangeText, holdText
} from './timed';
import { didSet, evenReps, type PlanDay, type PlannedExercise, type ProgressState, type ProgressItem, type TrainingPlan, type WorkoutLog } from './types';

export interface WorkoutEntry {
  exerciseId: string;
  /**
   * 每组做了什么。计时型的组 `reps` 为 0、实际时长在 `sec`(见 engine/timed.ts)。
   *
   * ⚠️ 判断「这组做了没有」**不能只看 `reps > 0`** —— 那会把每一个计时组都当成没做,
   * 于是撑了 90 秒的平板支撑既不进日志、也不进任何统计,而且**不报错**。
   * 一律走 `didSet()`。
   */
  sets: { reps: number; weightKg: number | null; done: boolean; rir?: number | null; sec?: number }[];
  /**
   * 这个动作**本次不计入进阶**(训练页那个动作卡片上的开关)。
   * 只挡住推导这一半:组数、容量、纪录照常(见 types.WorkoutLog.entries[*].noProg)。
   */
  noProg?: boolean;
}

/**
 * 这个动作在这一天里**会不会被推进** —— 推得动的前提是手上有它的处方
 * (组数/次数区间/重量阶梯都挂在计划条目上),计划外的动作没有这些东西,硬推只会凭空改目标。
 *
 * 页面用它决定「本次不计入进阶」要不要露出来:**露了却什么都不会发生,比不露更糟**
 * (用户点一下,以为自己排除了那个动作,其实它本来就没在算账)。
 * 判据和 `applyWorkout` 里那半段必须是同一条 —— 所以放在这儿由两边共用。
 */
export const canProgress = (day: PlanDay, exerciseId: string): boolean =>
  day.items.some((it) => it.exerciseId === exerciseId);

const LEVEL_RANK: Record<string, number> = { '': 0, beginner: 1, intermediate: 2, expert: 3 };
const LADDER_REP_CAP = 25;    // 徒手目标次数封顶,超过该进阶变式而不是无限加次数
const TRIPLE_SET_CAP = 5;     // 三阶渐进:组数加到 5 组就不再加,改为加重

/** 自重动作的进阶变式推荐(同部位更难的徒手动作) */
function harderVariant(exerciseId: string): string | null {
  const cur = EXERCISES.find((e) => e.id === exerciseId);
  if (!cur) return null;
  const curRank = LEVEL_RANK[cur.level] ?? 0;
  const better = EXERCISES.filter((e) =>
    e.id !== exerciseId
    && e.bodyPart === cur.bodyPart
    && e.equipment === 'body weight'
    && ['calisthenics', 'strength', 'plyometrics', 'isometric'].includes(e.category)
    && (LEVEL_RANK[e.level] ?? 0) > curRank
  );
  return better.length ? better[0].nameZh : null;
}

/** 时长目标的下限 —— 再往下回退就没意义了(10 秒的平板支撑不叫一组) */
const HOLD_MIN_FLOOR_SEC = 10;

/**
 * 计时型动作的渐进 —— 撑到区间上限就 +5 秒,连续两次没撑到就回退 5 秒,
 * 到 120 秒封顶之后:有配重的(农夫行走)改为加重并把时长回到起点,
 * 没配重的(平板支撑)推荐更难的变式。和次数型的 `ladder` / `triple` 是同一套骨架,
 * 只是推的变量从「次数」换成了「秒数」。
 *
 * 为什么不能硬套次数规则:那几条全都建立在「重量与次数此消彼长」上,而时长动作
 * 大多没有重量,唯一能推的变量就是秒。套错的后果不是报错,是把 `repsMax` 从 0
 * 加到 2 再加到 4 —— 用户会看到一个「目标 4 次」的平板支撑。
 *
 * `s.sec` 缺失当 0 处理(旧日志里没有这个字段),于是它走「没撑到」那一支 ——
 * 安全的方向:宁可不动目标,也不该凭一个不存在的秒数往上加。
 */
function progressHold(
  item: PlannedExercise,
  cur: ProgressItem,
  doneSets: WorkoutEntry['sets'],
  now: string
): { next: ProgressItem; change: string | null } {
  const target = cur.holdSec ?? item.holdSec ?? { min: HOLD_DEFAULT_SEC, max: HOLD_DEFAULT_SEC };
  const secs = doneSets.map((s) => Math.max(0, Math.round(s.sec ?? 0)));

  if (!secs.every((s) => s >= target.min)) {
    const failStreak = cur.failStreak + 1;
    if (failStreak >= 2) {
      const min = Math.max(target.min - HOLD_PROGRESS_BACK_SEC, HOLD_MIN_FLOOR_SEC);
      const max = Math.max(target.max - HOLD_PROGRESS_BACK_SEC, min + HOLD_PROGRESS_STEP_SEC);
      return {
        next: { ...cur, holdSec: { min, max }, failStreak: 0, successStreak: 0, updatedAt: now },
        change: `${item.nameZh} 时长目标回调到 ${holdRangeText(min, max)}(先把动作撑标准)`
      };
    }
    return { next: { ...cur, failStreak, successStreak: 0, updatedAt: now }, change: null };
  }

  const base = { ...cur, successStreak: cur.successStreak + 1, failStreak: 0, updatedAt: now };

  if (secs.every((s) => s >= target.max) && target.max < HOLD_PROGRESS_CAP_SEC) {
    const min = target.min + HOLD_PROGRESS_STEP_SEC;
    const max = Math.min(target.max + HOLD_PROGRESS_STEP_SEC, HOLD_PROGRESS_CAP_SEC);
    return {
      next: { ...base, holdSec: { min, max } },
      change: `${item.nameZh} 时长目标 ${holdText(target.max)} → ${holdText(max)}`
    };
  }

  // 撑满上限了(或已经封顶)—— 和次数的 ladder 一样,下一步是换更难的,不是无限加时间
  if (secs.every((s) => s >= target.max)) {
    // 有配重的搬运类:加重量、时长回到区间起点,重新往上撑(双渐进那个形状)
    if (cur.weightKg != null && item.weightStepKg > 0) {
      const w = round2(cur.weightKg + item.weightStepKg);
      return {
        next: { ...base, weightKg: w },
        change: `${item.nameZh} 已经撑满 ${holdText(target.max)},加重 ${cur.weightKg}kg → ${w}kg(时长回到 ${holdText(target.min)})`
      };
    }
    const sug = harderVariant(item.exerciseId);
    if (sug) {
      return {
        next: { ...base, suggestion: sug },
        change: `${item.nameZh} 已经撑满 ${holdText(target.max)},建议换更难变式:${sug}`
      };
    }
    return {
      next: base,
      change: `${item.nameZh} 已经撑满 ${holdText(target.max)},保持当前难度巩固`
    };
  }

  return {
    next: base,
    change: `${item.nameZh} 保持,继续把每组撑到 ${holdText(target.max)}`
  };
}

/** 单动作渐进推导 — item 为该动作当前目标(优先取 progress 里的实时值) */
function progressOne(
  item: PlannedExercise,
  entry: WorkoutEntry,
  prev: ProgressItem | undefined
): { next: ProgressItem; change: string | null } {
  const cur: ProgressItem = prev ?? {
    exerciseId: item.exerciseId,
    weightKg: item.weightKg,
    repsMin: item.repsMin,
    repsMax: item.repsMax,
    sets: item.sets,
    holdSec: item.holdSec,
    successStreak: 0,
    failStreak: 0,
    suggestion: null,
    updatedAt: ''
  };
  // 助力器械:计划里存的老版本可能还写着 linear(修复前生成的),这里按动作纠一次 ——
  // 「加重量」在助力器械上等于加助力,那是把动作变简单,方向反了。
  const assisted = isAssisted(item.exerciseId);
  const kind = assisted ? 'ladder' : item.progression;
  const doneSets = entry.sets.filter((s) => s.done && didSet(s));
  const allDone = doneSets.length >= entry.sets.length;
  const now = new Date().toISOString();
  let change: string | null = null;
  // 单侧动作的次数是两侧合计,写回去的目标要落在偶数上(奇数一定有一侧少做一个)
  const fit = (n: number) => (item.sided ? evenReps(n) : n);
  // 说给用户听的次数:单侧动作说「每侧几次」—— 合计 24 对他没有意义,他数的是每侧 12
  const repsText = (n: number) => (item.sided ? `每侧 ${sideRepsText(n)} 次` : `${n} 次`);

  // 有组没练完:不算失败,但也不渐进(保留当前目标)
  if (!allDone) {
    return { next: { ...cur, updatedAt: now }, change: null };
  }

  // 走周期波次:重量次数由 %训练最大重量 处方定,这里只留今天的记录,不改目标
  // (改了会和波次开的重量打架;基准的上调在周期走满一轮时做,见 cycle.advanceCycle)
  if (item.cycleLocked) {
    return { next: { ...cur, updatedAt: now }, change: null };
  }

  // 计时型动作走**时长阶梯**,和下面那整套次数规则完全分开。
  // 这一段必须挡在 minOk/maxOk 之前 —— 计时项留在计划里的 `repsMin/repsMax` 都是 0,
  // 漏下去的后果是「0 >= 0」每次都算达标,然后按次数规则去推一个不存在的次数目标。
  if (item.holdSec) {
    return progressHold(item, cur, doneSets, now);
  }

  const minOk = doneSets.every((s) => s.reps >= cur.repsMin);
  const maxOk = doneSets.every((s) => s.reps >= cur.repsMax);

  if (!minOk) {
    // 未达标
    const failStreak = cur.failStreak + 1;
    if (failStreak >= 2) {
      // 助力器械不能「减载」:减助力 = 加难度,人明明没做到还给他提高难度。回退次数。
      if (!assisted && cur.weightKg != null && cur.weightKg > 0) {
        const w = Math.max(Math.round(cur.weightKg * 0.9 * 2) / 2, 1); // 取整到 0.5kg
        change = `${item.nameZh} 减载到 ${w}kg(连续两次未达标,降一档再来)`;
        return { next: { ...cur, weightKg: w, failStreak: 0, successStreak: 0, updatedAt: now }, change };
      }
      // 徒手:目标次数回退 2(不低于区间下限)
      const rMin = fit(Math.max(cur.repsMin - 2, 5));
      const rMax = fit(Math.max(cur.repsMax - 2, rMin + 3));
      change = `${item.nameZh} 次数目标回调(难度略降,先把动作做标准)`;
      return { next: { ...cur, repsMin: rMin, repsMax: rMax, failStreak: 0, successStreak: 0, updatedAt: now }, change };
    }
    return { next: { ...cur, failStreak, successStreak: 0, updatedAt: now }, change };
  }

  // 达标以上 — 按规则渐进
  const successStreak = cur.successStreak + 1;
  const base = { ...cur, successStreak, failStreak: 0, updatedAt: now };

  // 末组尽力(AMRAP)还能多做 3 个以上:当前重量明显偏轻,直接跳两档
  const bonus = item.amrapLast
    && doneSets.length >= 2
    && (doneSets[doneSets.length - 1].reps >= cur.repsMax + 3);
  const stepK = item.weightStepKg * (bonus ? 2 : 1);
  const tail = bonus ? '(末组多做很多,多加一档)' : '';

  if (kind === 'linear' && maxOk === false && minOk) {
    // 线性:达到下限即加重(新手期快速上行)
    if (cur.weightKg != null) {
      const w = round2(cur.weightKg + stepK);
      change = `${item.nameZh} ${cur.weightKg}kg → ${w}kg${tail}`;
      return { next: { ...base, weightKg: w }, change };
    }
  }

  if (kind === 'double' && maxOk) {
    if (cur.weightKg != null) {
      const w = round2(cur.weightKg + stepK);
      change = `${item.nameZh} 加重 ${cur.weightKg}kg → ${w}kg(次数回落,重新往上推)${tail}`;
      return { next: { ...base, weightKg: w }, change };
    }
  }

  if (kind === 'triple' && maxOk) {
    const sets = cur.sets ?? item.sets;
    // 第二阶:次数推满了先加组,而不是加重 — 同样的重量多练一组,比硬加重量稳
    if (sets < TRIPLE_SET_CAP) {
      change = `${item.nameZh} 次数推满,加一组(共 ${sets + 1} 组)`;
      return { next: { ...base, sets: sets + 1 }, change };
    }
    // 第三阶:组数到顶,加重并回到起点组数重推
    if (cur.weightKg != null) {
      const w = round2(cur.weightKg + stepK);
      change = `${item.nameZh} ${sets} 组都练满,加重 ${cur.weightKg}kg → ${w}kg(组数回到 ${item.sets} 组重来)${tail}`;
      return { next: { ...base, weightKg: w, sets: item.sets }, change };
    }
  }

  if (kind === 'linear' && maxOk && cur.weightKg != null) {
    // 线性规则下全部打到上限 — 同样按步长走,提示可以加更多
    // (末组尽力多做很多时走 stepK,至少两档)
    const k = bonus ? item.weightStepKg * 2 : item.weightStepKg * 1.5;
    const w = round2(cur.weightKg + k);
    change = `${item.nameZh} ${cur.weightKg}kg → ${w}kg`
      + (bonus ? '(末组多做很多,多加一档)' : '(轻松达标,多加一点)');
    return { next: { ...base, weightKg: w }, change };
  }

  if (kind === 'ladder' && maxOk) {
    // 单侧动作的次数是两侧合计,封顶也要落在偶数上(24 = 每侧 12);不然会出现「每侧 12.5 次」
    const cap = item.sided ? evenReps(LADDER_REP_CAP - 1) : LADDER_REP_CAP;
    if (cur.repsMax >= cap) {
      // 助力器械先降助力 —— 次数已经推满,下一步就是「少让人帮一把」,这才是它的渐进
      if (assisted && cur.weightKg != null && cur.weightKg > 0) {
        const w = Math.max(round2(cur.weightKg - item.weightStepKg), 0);
        change = `${item.nameZh} 次数已到顶,下次把助力调到 ${w}kg(助力越小,越是自己发力)`;
        return { next: { ...base, weightKg: w }, change };
      }
      const sug = harderVariant(item.exerciseId);
      if (sug) {
        change = `${item.nameZh} 次数已到顶,建议换更难变式:${sug}`;
        return { next: { ...base, suggestion: sug }, change };
      }
      change = `${item.nameZh} 次数已到顶,保持当前难度巩固`;
      return { next: base, change };
    }
    const rMin = fit(cur.repsMin + 2);
    const rMax = fit(cur.repsMax + 2);
    change = `${item.nameZh} 目标次数 ${repsText(cur.repsMax)} → ${repsText(rMax)}`;
    return { next: { ...base, repsMin: rMin, repsMax: rMax }, change };
  }

  // 达标但不触发渐进(如 double/triple 区间内加次数中)
  if (kind === 'double' || kind === 'triple') {
    change = `${item.nameZh} 保持重量,继续把每组次数推到 ${repsText(cur.repsMax)}`;
  }
  return { next: base, change };
}

export interface WorkoutResult {
  next: ProgressState;
  log: WorkoutLog;
  /** 本次训练的变化汇总(顶部里程碑/结果页展示) */
  notes: string[];
}

/**
 * 完成一次训练:算日志 + 推导下次目标。
 *
 * `noProg`(这次不算进步,伤后/状态很差的那次)只跳过**推导**这一半:
 * 日志照常落库、组数容量照常算(那天确实练了,也照常进曲线和热力图),
 * 但下次目标一动不动 —— 状态差的那次不该把目标一路往下带。
 *
 * 两个粒度:`noProg` 参数是**整场**(今天整场不算),`entry.noProg` 是**单个动作**
 * (只有那个动作不算)。任一条命中,那个动作的推导就跳过;两个口径的取舍写在
 * `types.WorkoutLog.entries[*].noProg` 上。
 */
export function applyWorkout(
  plan: TrainingPlan,
  dayKey: string,
  entries: WorkoutEntry[],
  durationSec: number,
  prevProgress: ProgressState,
  /** 本次训练的感受备注(可选) */
  note?: string,
  /** 这次不算进步(可选) */
  noProg = false
): WorkoutResult {
  const day = plan.days.find((d) => d.key === dayKey) ?? plan.days[0];
  const next: ProgressState = { ...prevProgress };
  const notes: string[] = [];
  const logEntries: WorkoutLog['entries'] = [];

  for (const entry of entries) {
    const item = day.items.find((it) => it.exerciseId === entry.exerciseId);
    /**
     * 计划里没有的动作**不是**坏数据 —— 训练页有两个口子会造出它:「换个动作」换到计划外的动作、
     * 「加练一个动作」插进来的那个。名字从动作库/自助动作里取(和别处同一个查找)。
     * (以前这里是 `if (!item) continue`,于是这两条路上练的东西在训练页上看着好好的,
     *  记完日志里却没有:不进容量、不进纪录、不动力量基准、分享卡上也没有 —— 静默丢数据。)
     */
    const nameZh = item?.nameZh ?? findExercise(entry.exerciseId)?.nameZh;
    // 连名字都查不到(自己建的动作后来被删了)—— 这一条确实没东西可记,放弃
    if (!nameZh) continue;
    // 渐进不碰计划外的动作:手上没有它的处方(组数/次数区间/重量阶梯),硬推只会凭空改目标
    // (判据与 `canProgress` 同源 —— 页面那个开关露不露出来就看它)
    if (item && !noProg && !entry.noProg) {
      const { next: n, change } = progressOne(item, entry, prevProgress[item.exerciseId]);
      next[item.exerciseId] = n;
      if (change) notes.push(change);
    }
    logEntries.push({
      exerciseId: entry.exerciseId,
      nameZh,
      // 组号只在真有超级组时写进去(通知/分享/复制的老形状一个字节都不变)
      ...(item?.superset ? { superset: item.superset } : {}),
      sets: entry.sets
        .filter((s) => s.done && didSet(s))
        .map((s) => ({
          reps: s.reps,
          weightKg: s.weightKg,
          rir: s.rir ?? null,
          // 计时组把秒数原样带上;次数组不带这个字段(老形状一个字节都不变)
          ...(s.sec != null && s.sec > 0 ? { sec: Math.round(s.sec) } : {})
        })),
      // 标了「本次不计入进阶」的记下来 —— 目标没动这件事要让**日志**也知道,
      // 不然以后回看这一场,只看得见「目标没变」这个结果,看不出那是人有意排除的
      ...(entry.noProg ? { noProg: true as const } : {})
    });
  }

  const totalSets = logEntries.reduce((a, e) => a + e.sets.length, 0);
  const totalReps = logEntries.reduce((a, e) => a + e.sets.reduce((x, s) => x + s.reps, 0), 0);
  const totalVolumeKg = round2(logEntries.reduce(
    (a, e) => a + e.sets.reduce((x, s) => x + s.reps * (s.weightKg ?? 0), 0), 0
  ));
  const sessionRir = avgRir(logEntries.flatMap((e) => e.sets.map((s) => s.rir)));

  const log: WorkoutLog = {
    id: `wo-${Date.now()}`,
    planId: plan.id,
    dayKey: day.key,
    dayTitle: day.title,
    /* 这一格必须走本地日期:原来用 toISOString().slice(0,10) 取的是 **UTC 那天**,
       东八区凌晨 0–8 点练完记下的是**前一天** —— 提醒会说「你今天还没练」、
       热力图和连胜也会少一格,而用户明明刚练完(见 utils/date.ts 开头那段)。 */
    date: todayStr(),
    durationSec: Math.max(60, Math.round(durationSec)),
    totalSets,
    totalReps,
    totalVolumeKg,
    avgRir: sessionRir,
    note: note?.trim() ? note.trim().slice(0, 100) : null,
    entries: logEntries
  };
  if (noProg) log.noProg = true;

  return { next, log, notes };
}
