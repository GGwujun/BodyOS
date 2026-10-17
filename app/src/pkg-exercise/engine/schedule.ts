/**
 * 训练日程与轮转 —— 「今天该练哪天」「隔多久没练算欠账」的唯一出处。
 *
 * 计划里有两层东西,别混:
 *   · `plan.days`   = **练什么**(推日/拉日/腿日,各自的动作和组次);
 *   · `plan.schedule` = **什么时候练**(固定周哪几天,或一套轮转顺序)。
 * 一个训练日可以被固定周排两次、也可以同时在轮转里;复制一份训练日的话,
 * 两份的渐进、历史、备注从此各走各的 —— 那才是真正的问题。
 *
 * 两种日程模式:
 *   · `week`     —— 周一到周日各自排好,到那天练那天;空的那天就是休息日。
 *   · `rotation` —— 一串训练日按顺序轮,不看星期几。做完最后一个从第一个再来。
 * 轮转旁边还可以有「也固定练的日子」:那些天会**叠加**在轮转的下一套上。
 *
 * ## 轮转的「下一个」是算出来的,不是存下来的
 *
 * 存储里只有顺序(`rotation`)和可选的重开日期。哪几套已经做过,由日志倒推:
 * 从旧到新扫一遍,遇到日志就把它的训练日标记成本轮已完成;一轮全齐了就开下一轮,
 * 并且下一轮从**刚做完那一套的后面**开始(openGym 的 refillAfter 也是这个规则)。
 * 好处是换设备、补录、离线合并都不会让一份「轮转进度」和日志对不上 ——
 * 日志本身就是唯一的事实。
 *
 * ## 老计划没有 schedule
 *
 * 读的时候按「所有训练日按计划顺序轮转」解释(见 scheduleOf)。这正是以前
 * 「挑最久没练的那个」想做的事,只是现在顺序固定了。第一次改日程时会把它写下来。
 *
 * 「今天该不该练」不能查日历,还得看用户自己的实际节奏 —— `rhythmDays` /
 * `missedCount` 那半段就是干这个的:隔多久没练算欠账,提醒文案也靠它。
 */
import { addDays, dayDiff, mondayOf, parseDay, todayStr } from '../../utils/date';
import { excusedBetween, type DayNotes } from './daynote';
import { logDayKeys, type PlanDay, type PlanSchedule, type TrainingPlan, type WorkoutLog } from './types';

/** 节奏(天)的上下界:1 = 每天都练,7 = 一周一次 */
export const MIN_RHYTHM = 1;
export const MAX_RHYTHM = 7;
/** 连着欠满这么多次就闭嘴(一个长假不该变成每天的唠叨) */
export const NUDGE_MAX_MISSES = 3;
/** 没有计划天数、记录也太少时的默认节奏(一周三次左右) */
const FALLBACK_RHYTHM = 3;
/** 参与中位数的间隔样本上限 */
const MEDIAN_SAMPLE = 6;
/** 至少要有这么多个间隔才敢按实际节奏走 */
const MEDIAN_MIN = 3;

/** 周一到周日(下标就是 PlanSchedule.week 的下标) */
export const WEEKDAY_ZH = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
/** 一行里用的单字:周一 → 一 */
export const WEEKDAY_ONE = ['一', '二', '三', '四', '五', '六', '日'];

const clamp = (n: number): number =>
  Number.isFinite(n) ? Math.min(MAX_RHYTHM, Math.max(MIN_RHYTHM, Math.round(n))) : FALLBACK_RHYTHM;

/** 日期是周几(0 = 周一 … 6 = 周日)。和 mondayOf 同一套口径 */
export function weekdayOf(date: string): number {
  const d = parseDay(date);
  return Number.isFinite(d.getTime()) ? (d.getDay() + 6) % 7 : 0;
}

const unique = (xs: string[]): string[] => xs.filter((x, i) => !!x && xs.indexOf(x) === i);

/**
 * 计划生效的日程。**读取入口只有这一个** —— 老计划、被手动改过的存储、云端合并下来的
 * 脏 key 都在这里收口:引用不存在的训练日的条目一律丢掉。
 * (一条指向已删训练日的轮转项如果漏过去,「下一个」会永远指向一个打不开的页。)
 *
 * 缺省(老计划)是「所有训练日按计划顺序轮转」;`schedule` 存在但 rotation 被清空时
 * **保持空** —— 用户把轮转删空是明确的意思,不能拿默认值把它填回去。
 */
export function scheduleOf(plan: TrainingPlan | null): PlanSchedule {
  const days = plan?.days ?? [];
  const valid = new Set(days.map((d) => d.key));
  const raw = plan?.schedule;
  const week = Array.from({ length: 7 }, (_, i) => {
    const keys = Array.isArray(raw?.week?.[i]) ? raw!.week[i] : [];
    return unique(keys.filter((k) => valid.has(k)));
  });
  let rotation = unique((raw?.rotation ?? []).filter((k) => valid.has(k)));
  if (!raw) rotation = days.map((d) => d.key);
  return {
    mode: raw?.mode === 'week' ? 'week' : 'rotation',
    week,
    rotation,
    ...(raw?.rotationStart ? { rotationStart: raw.rotationStart } : {})
  };
}

/** 写回一份日程(顺手过一遍 scheduleOf 的清洗);内容没变就原样返回,别制造无意义的同步 */
export function withSchedule(plan: TrainingPlan, patch: Partial<PlanSchedule>): TrainingPlan {
  const cur = scheduleOf(plan);
  const next: PlanSchedule = {
    ...cur,
    ...patch,
    week: patch.week ?? cur.week,
    rotation: patch.rotation ?? cur.rotation
  };
  const clean = scheduleOf({ ...plan, schedule: next });
  if (JSON.stringify(clean) === JSON.stringify(cur)) return plan;
  return { ...plan, schedule: clean };
}

/** 固定周某一天排什么(多套 = 合并训练);传空数组就是休息日 */
export function setWeekday(plan: TrainingPlan, dow: number, keys: string[]): TrainingPlan {
  const cur = scheduleOf(plan);
  if (dow < 0 || dow > 6) return plan;
  const valid = new Set((plan.days ?? []).map((d) => d.key));
  const week = cur.week.map((x) => x.slice());
  week[dow] = unique(keys.filter((k) => valid.has(k)));
  return withSchedule(plan, { week });
}

/** 轮转顺序整份覆盖(添加/排序/移除都走它) */
export function setRotation(plan: TrainingPlan, keys: string[]): TrainingPlan {
  const valid = new Set((plan.days ?? []).map((d) => d.key));
  return withSchedule(plan, { rotation: unique(keys.filter((k) => valid.has(k))) });
}

/** 把某一套在轮转里往前/往后挪一格;挪不动就原样返回 */
export function moveInRotation(plan: TrainingPlan, key: string, delta: number): TrainingPlan {
  const seq = scheduleOf(plan).rotation.slice();
  const i = seq.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= seq.length) return plan;
  [seq[i], seq[j]] = [seq[j], seq[i]];
  return setRotation(plan, seq);
}

/** 把训练日从轮转里拿掉(固定周的安排不动) */
export function removeFromRotation(plan: TrainingPlan, key: string): TrainingPlan {
  const seq = scheduleOf(plan).rotation;
  return seq.includes(key) ? setRotation(plan, seq.filter((k) => k !== key)) : plan;
}

/**
 * 「从头开始这一轮」—— 记下今天,这一条之前的日志不再算进本轮。
 * 固定周不轮转,这个动作只对 rotation 有意义。
 */
export function restartRotation(plan: TrainingPlan, today = todayStr()): TrainingPlan {
  return withSchedule(plan, { rotationStart: today });
}

/** 切「固定周 / 轮转」。轮转顺序和固定周安排都留着,切回来不用重排 */
export function setScheduleMode(plan: TrainingPlan, mode: 'week' | 'rotation'): TrainingPlan {
  return withSchedule(plan, { mode });
}

/** 某个训练日排在固定周的哪几天(按周一到周日) */
export function weekdaysOf(plan: TrainingPlan | null, key: string): number[] {
  const sched = scheduleOf(plan);
  return sched.week
    .map((keys, i) => (keys.includes(key) ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * 轮转这一轮走到哪儿了 —— 全部由日志倒推(规则见文件头)。
 * 空轮转返回一套空值,调用方不用先判断。
 */
export interface RotationState {
  /** 清洗后的顺序 */
  seq: string[];
  /** 本轮已经做过的训练日 */
  done: Set<string>;
  /** 本轮做了几套(合并训练里做了两套就 +2) */
  doneCount: number;
  /** 本轮是否已经全做完(做完后下一次日志才开新一轮) */
  complete: boolean;
  /** 下一套;轮转空时是 '' */
  nextKey: string;
  /** 这一轮从顺序里的第几个开始(上一轮做完最后一套的下一格) */
  roundStart: number;
}

export function rotationState(
  plan: TrainingPlan | null,
  logs: WorkoutLog[],
  today = todayStr()
): RotationState {
  const sched = scheduleOf(plan);
  const seq = sched.rotation;
  const empty: RotationState = { seq, done: new Set(), doneCount: 0, complete: false, nextKey: '', roundStart: 0 };
  if (!seq.length) return empty;
  const idx = new Map(seq.map((k, i) => [k, i]));
  const since = sched.rotationStart ?? '';
  // 日志是新的在前;倒推轮次要按时间正序。同一天内顺序本来就没有记录,
  // 稳定排序保留原顺序即可 —— 同一天练两套时哪套先算哪套后只影响「下一轮从谁开始」。
  const asc = logs
    .filter((l) => l && typeof l.date === 'string' && l.date >= since)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let done = new Set<string>();
  let roundStart = 0;
  for (const log of asc) {
    // 上一轮已在上一批日志里收尾 → 这一条属于新一轮
    if (done.size === seq.length) done = new Set<string>();
    for (const k of logDayKeys(log)) {
      if (idx.has(k)) done.add(k);
    }
    if (done.size === seq.length) {
      // 收尾的这一条可能一次做了两套(合并训练),下一轮从**顺序里靠后**的那套之后开始
      const credited = logDayKeys(log).filter((k) => idx.has(k));
      const last = credited.length ? Math.max(...credited.map((k) => idx.get(k)!)) : roundStart;
      roundStart = (last + 1) % seq.length;
    }
  }
  const ordered = seq.map((_, i) => seq[(roundStart + i) % seq.length]);
  const nextKey = ordered.find((k) => !done.has(k)) ?? seq[roundStart];
  return {
    seq,
    done,
    doneCount: done.size,
    complete: done.size === seq.length,
    nextKey,
    roundStart
  };
}

/**
 * 某一天日程上要练的训练日 key(不含按天改练)。
 *   · 固定周:就是那天排的几套;
 *   · 轮转:下一套 + 那一天「也固定练」的、且不在轮转里的几套(叠加)。
 * 返回空 = 休息日。多套用 `dayForKeys` 合成一套来显示/开练。
 */
export function scheduleDayKeys(
  plan: TrainingPlan | null,
  logs: WorkoutLog[],
  date: string
): string[] {
  if (!plan?.days?.length) return [];
  const sched = scheduleOf(plan);
  const dow = weekdayOf(date);
  if (sched.mode === 'week') return sched.week[dow];
  const rot = rotationState(plan, logs, date);
  const inLoop = new Set(rot.seq);
  const extras = sched.week[dow].filter((k) => !inLoop.has(k));
  return unique([...(rot.nextKey ? [rot.nextKey] : []), ...extras]);
}

/** 「训练日 key 串」→ 单个 key 数组。合并训练的合成 key 是 `a+b` */
export function splitDayKey(key: string): string[] {
  return unique(key.split('+').map((s) => s.trim()).filter(Boolean));
}

/** 合成 key(多套合并训练时日志/快照里用的那个) */
export function joinDayKeys(keys: string[]): string {
  return unique(keys).join('+');
}

const combineTitle = (titles: string[]): string => {
  if (titles.length <= 1) return titles[0] ?? '';
  if (titles.length <= 3) return titles.join(' + ');
  return `${titles[0]} + ${titles[1]} + 另 ${titles.length - 2} 套`;
};

/**
 * 几个训练日 key → 一套可显示、可开练的 PlanDay。
 * 单套原样返回;多套按顺序拼起来,同名动作只留第一次(两套都排了卧推时,
 * 合并那场不该出现两张一模一样的卧推卡)。
 */
export function dayForKeys(plan: TrainingPlan | null, keys: string[]): PlanDay | null {
  if (!plan?.days?.length) return null;
  const uniq = unique(keys);
  const days = uniq
    .map((k) => plan.days.find((d) => d.key === k))
    .filter((d): d is PlanDay => !!d);
  if (!days.length) return null;
  if (days.length === 1) return days[0];
  const seen = new Set<string>();
  const items: PlanDay['items'] = [];
  for (const d of days) {
    for (const it of d.items) {
      if (seen.has(it.exerciseId)) continue;
      seen.add(it.exerciseId);
      items.push(it);
    }
  }
  const focus = unique(days.map((d) => d.focus).filter(Boolean)).join(' · ');
  return {
    key: joinDayKeys(days.map((d) => d.key)),
    title: combineTitle(days.map((d) => d.title).filter(Boolean)),
    focus,
    estMin: days.reduce((n, d) => n + (d.estMin || 0), 0),
    items
  };
}

/** 按 key 串找那天(合并 key 也认) —— 日志/快照回读时用 */
export function dayOfKey(plan: TrainingPlan | null, key: string): PlanDay | null {
  return dayForKeys(plan, splitDayKey(key));
}

export function trainedDates(logs: WorkoutLog[]): string[] {
  return [...new Set(logs.map((l) => l?.date).filter((d): d is string => typeof d === 'string' && !!d))].sort();
}

/**
 * 下一个该练的训练日 key。
 *   · 固定周:今天排的那一套(多套时返回第一套;**完整的一串**请用 scheduleDayKeys);
 *   · 轮转:本轮下一套。
 * 休息日返回 ''。
 */
export function nextDayKey(plan: TrainingPlan, logs: WorkoutLog[], date = todayStr()): string {
  const keys = scheduleDayKeys(plan, logs, date);
  return keys[0] ?? '';
}

/** 今天(或指定日期)该练的那一套 —— 找不到/休息日返回 null */
export function nextDayOf(plan: TrainingPlan | null, logs: WorkoutLog[], date = todayStr()) {
  return dayForKeys(plan, scheduleDayKeys(plan, logs, date));
}

/**
 * 用户的训练节奏(天)。最近 6 次训练里相邻间隔的中位数;样本不足 3 个时
 * 退回计划的每周天数。中位数而不是平均数:旅行回来补练两天的极端值不该带偏节奏。
 */
export function rhythmDays(plan: TrainingPlan | null, logs: WorkoutLog[]): number {
  const dates = trainedDates(logs);
  const gaps: number[] = [];
  for (let i = dates.length - 1; i > 0 && gaps.length < MEDIAN_SAMPLE; i--) {
    const g = dayDiff(dates[i - 1], dates[i]);
    if (g > 0) gaps.push(g); // 同一天两次已经被 trainedDates 去掉了,g <= 0 只可能是脏数据
  }
  if (gaps.length >= MEDIAN_MIN) {
    const sorted = [...gaps].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return clamp(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }
  const perWeek = plan?.daysPerWeek ?? 0;
  return clamp(perWeek > 0 ? 7 / perWeek : FALLBACK_RHYTHM);
}

/** 今天之前最近一次训练的日期(null = 今天没练过且往前没有记录) */
export function lastTrainedBefore(logs: WorkoutLog[], today: string): string | null {
  let last = '';
  for (const l of logs) {
    if (l && typeof l.date === 'string' && l.date < today && l.date > last) last = l.date;
  }
  return last || null;
}

/**
 * 欠了几次训练:距上次训练这么多天里,有多少个「该练的日子」被跳过了。
 * 节奏 2 天、隔了 5 天 → 该练的日子落在第 2、4 天 → 欠 2 次(取 floor,
 * 因为第 6 天还没到)。今天已经练过 = 不欠。有计划但一次没练过 = 欠 1(第一练还没开张)。
 *
 * `notes` 是请过假的日子(见 daynote.ts):**这些天不进分母**。
 * 出差 6 天回来,节奏 2 天,原来要算成欠 3 次(直接顶到「不催了」那一档),
 * 现在只算 0 —— 他本来就不该练,谈不上欠。
 * 起算点单独说明:窗口是 (上次训练那天, 今天] 这半开区间,和 dayDiff 的口径一致。
 */
export function missedCount(
  plan: TrainingPlan | null,
  logs: WorkoutLog[],
  today: string,
  notes: DayNotes = {}
): number {
  if (logs.some((l) => l?.date === today)) return 0;
  const last = lastTrainedBefore(logs, today);
  if (!last) return plan?.days?.length ? 1 : 0;
  const gap = dayDiff(last, today);
  if (gap < 1) return 0;
  const owed = Math.max(0, gap - excusedBetween(notes, last, today));
  return Math.floor(owed / rhythmDays(plan, logs));
}

/**
 * 日程视图要用的「本周七天」—— 固定周下每天排的是什么(没有就是休息)。
 * `week` 模式和「也固定练的日子」都用它;轮转的下一套不在其中。
 */
export function weekPlan(
  plan: TrainingPlan | null
): { dow: number; date: string; keys: string[]; day: PlanDay | null }[] {
  const mon = mondayOf(todayStr());
  const sched = scheduleOf(plan);
  return WEEKDAY_ZH.map((_, dow) => {
    const keys = sched.week[dow];
    return { dow, date: addDays(mon, dow), keys, day: dayForKeys(plan, keys) };
  });
}
