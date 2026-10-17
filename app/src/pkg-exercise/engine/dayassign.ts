/**
 * 按天改练 —— 「今天不按轮转来,我要练那天那一套」。
 *
 * 为什么需要:BodyOS 的计划是**轮转**的(挑最久没练的那个训练日,见 `schedule.nextDayKey`),
 * 它没有「周一练推、周三练拉」的课表。这套规则对绝大多数日子是对的 —— 它只关心
 * 「哪个训练日欠得最久」。但它认不出一种很常见的事:**今天想练另外那天的**。
 * 深蹲架在排队、今天就是只想练腿、跟朋友约了一起练上半身 —— 课表本身没错,
 * 错的是今天。这时候用户能做的只有两件都不对的:照轮转练一个不想练的,
 * 或者练了却把它记成别的训练日(那会污染渐进和力量曲线)。
 *
 * 所以这里让用户把话说出来:这一天,练那天的课表。
 *
 * ## 它只管**练哪天**,不管**练不练**
 *
 * 「今天不练」已经有说法了 —— `daynote` 的「主动休息」。同一件事只允许一个说法,
 * 所以这里**没有** rest 分支,界面上那一条直接指过去。
 *
 * 这也是它和 `daynote` **分开存**的原因:两者的语义不同。`daynote` 是
 * 「为什么我不该被催」(它进欠账与提醒的**分母**),这里是「练哪一套」
 * (它决定**挑哪一天**)。塞进同一份记录的话,`kindOf` 就得开始分辨
 * 「有 kind 才算请假」,而请假条也会开始带上和请假无关的字段 ——
 * 而 daynote 那份的头注释明写着「**它不改计划**」,加进来就自相矛盾了。
 *
 * ## 三条边界
 *
 * ① **按日期存,天然过期。** 改练是「这一天」的事,不是「从此以后换计划」
 *    (后者是 plan-edit 的活)。所以过去那些日期的记录自动失效,不用清理,
 *    也不必担心它把轮转永久带偏。
 * ② **dayKey 必须还在计划里。** 计划重新生成过、老 key 已经不存在时退回轮转 ——
 *    一条读不懂的覆盖不能把用户卡在一个不存在的训练日上。
 * ③ **不改轮转。** 改练那天练完之后,日志里的 `dayKey` 就是改过去的那个,
 *    `nextDayKey` 照常看「哪个训练日最久没练」—— 你练了腿,腿就不该再排最前。
 *    这一条是**对的**,不是漏了。
 */
import Taro from '@tarojs/taro';
import { markTouched } from '../../utils/sync-marks';
import { isIsoDate } from './daynote';
import { scheduleDayKeys } from './schedule';
import type { TrainingPlan, WorkoutLog } from './types';

/** 存储 key —— 和 `bodyos.training.daynotes`(请假条)是两码事,别并成一份 */
export const K_DAYASSIGN = 'bodyos.training.dayassign';

/** 最多能提前多少天安排(和请假条同一个数:久到没有必要) */
export const ASSIGN_FUTURE_MAX = 30;
/** 能往前补记多久 —— 补记是为了让「那天练的其实是这套」能被记对 */
export const ASSIGN_PAST_MAX = 365;

export interface DayAssign {
  /** 这一天要练的训练日 key(落库前不校验,读的时候才对着计划校验) */
  dayKey: string;
  /** 改的时间(ISO) */
  at: string;
}

/** 日期 → 那天的改练安排 */
export type DayAssigns = Record<string, DayAssign>;

/**
 * 任意来源(本机 storage / 云端同步下来的)的一坨数据 → 干净的改练表。
 * 认不出来的条目**直接丢掉**而不是退回默认值 —— 这里和 `sanitizeDayNotes` 同一个道理:
 * 一条读不懂的改练如果被当成「今天练第一个训练日」,用户会莫名其妙地练错一整天,
 * 比少一条记录糟得多。**注意这里不校验 dayKey 在不在计划里**(那要计划才能判),
 * 留给 `assignOf` 做。
 */
export function sanitizeDayAssigns(raw: unknown): DayAssigns {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: DayAssigns = {};
  for (const [date, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isIsoDate(date) || !v || typeof v !== 'object') continue;
    const key = (v as DayAssign).dayKey;
    if (typeof key !== 'string' || !key) continue;
    const at = (v as DayAssign).at;
    out[date] = { dayKey: key, at: typeof at === 'string' ? at : '' };
  }
  return out;
}

/** 本机这份(读取时清洗 —— storage 里可能躺着旧版本写的脏数据) */
export function loadDayAssigns(): DayAssigns {
  return sanitizeDayAssigns(Taro.getStorageSync(K_DAYASSIGN));
}

export function saveDayAssigns(assigns: DayAssigns): void {
  Taro.setStorageSync(K_DAYASSIGN, assigns);
  markTouched('dayassign', 'main');
}

/** 这一天能不能安排 —— 返回不能的原因,能就返回空串(和 `noteBlockedBy` 同一个形状) */
export function assignBlockedBy(date: string, today: string): string {
  if (!isIsoDate(date)) return '日期不对';
  const ahead = new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime();
  const days = Math.round(ahead / 86400000);
  if (!Number.isFinite(days)) return '日期不对';
  if (days > ASSIGN_FUTURE_MAX) return `最多提前 ${ASSIGN_FUTURE_MAX} 天安排`;
  if (days < -ASSIGN_PAST_MAX) return '这可是很久以前了';
  return '';
}

/**
 * 这一天改练哪一天 —— 没改、或改到的那天**已经不在计划里**都返回 null。
 * 界面靠它区分「显示轮转建议」还是「显示已改练」,所以不存在的 key 必须在这里
 * 就露成 null,不能让它漏到调用方去。
 */
export function assignOf(plan: TrainingPlan | null, assigns: DayAssigns, date: string): string | null {
  if (!plan?.days?.length || !isIsoDate(date)) return null;
  const key = assigns[date]?.dayKey;
  return key && plan.days.some((d) => d.key === key) ? key : null;
}

/**
 * 这一天最终该练哪一天 —— **改练优先,否则照日程**。这是「今天练哪天」的唯一入口,
 * 训练页、提醒、计划页都走它,三处必须同一条(否则提醒说练推、点进去开练是拉)。
 *
 * 返回值可能是**几个 key 用 `+` 拼起来的合成 key**(固定周一天排了两套,或轮转的
 * 下一套叠加了当天固定练的那套)。要拆回每一套用 `schedule.splitDayKey`,
 * 要直接拿来开练就原样传给训练页 —— 训练页自己会拆。休息日返回 ''。
 */
export function resolveDayKey(
  plan: TrainingPlan,
  logs: WorkoutLog[],
  assigns: DayAssigns,
  date: string
): string {
  const assigned = assignOf(plan, assigns, date);
  if (assigned) return assigned;
  return scheduleDayKeys(plan, logs, date).join('+');
}

/** 在这一天改练某个训练日;日期不合法、或那个训练日不在计划里时原样返回,不写 */
export function setDayAssign(
  assigns: DayAssigns,
  date: string,
  dayKey: string,
  plan: TrainingPlan | null,
  today = ''
): DayAssigns {
  if (today && assignBlockedBy(date, today)) return assigns;
  if (!plan?.days?.some((d) => d.key === dayKey)) return assigns;
  const next: DayAssigns = { ...assigns, [date]: { dayKey, at: new Date().toISOString() } };
  saveDayAssigns(next);
  return next;
}

/** 取消这一天的改练 —— 回到轮转 */
export function clearDayAssign(assigns: DayAssigns, date: string): DayAssigns {
  if (!assigns[date]) return assigns;
  const next: DayAssigns = { ...assigns };
  delete next[date];
  saveDayAssigns(next);
  return next;
}

/**
 * 未来(含今天)已经安排好的改练,按日期升序。
 * 只给界面用 —— 让人看见「我后面几天已经排过了」,免得重复安排同一件事。
 */
export function upcomingAssigns(
  plan: TrainingPlan | null,
  assigns: DayAssigns,
  today: string,
  limit = 10
): { date: string; dayKey: string; title: string }[] {
  if (!plan?.days?.length) return [];
  const title = (k: string) => plan.days.find((d) => d.key === k)?.title ?? '';
  return Object.keys(assigns)
    .filter((d) => isIsoDate(d) && d >= today && assignOf(plan, assigns, d))
    .sort()
    .slice(0, limit)
    .map((date) => ({ date, dayKey: assigns[date].dayKey, title: title(assigns[date].dayKey) }));
}
