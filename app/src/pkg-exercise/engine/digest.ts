/**
 * 「今天这一摊」的小抄 —— 从计划、日志、请假条算出首页/训练 tab 要显示的那一屏。
 *
 * 原先长在 `plan-view/index.tsx` 里。抽出来的原因:补录/编辑日志的页面也要在
 * 保存后用**同一套判断**重写这张小抄 —— 把今天的日志改到昨天以后,首页不能还写着
 * 「今天练完了」。判断只留一份,两个入口才不会各说各的。
 */
import type { TrainingPlan, WorkoutLog } from './types';
import type { DayAssigns } from './dayassign';
import { assignOf, resolveDayKey } from './dayassign';
import type { DayNotes } from './daynote';
import { isExcused } from './daynote';
import { dayForKeys, dayOfKey, scheduleDayKeys } from './schedule';
import { addDays, mondayOf } from '../../utils/date';
import type { TrainingSnapshot, WeekDot } from '../../utils/training-digest';

/**
 * 本周七天的记号 —— 首页那排日期格子上要点什么(见 `utils/training-digest.ts`)。
 *
 * **只记发生过的事**,不预测未来:轮转制下「下周三练什么」取决于你接下来练不练,
 * 算不出一个说了不算的答案,所以未来的格子空着就是空着。
 * 练过 > 请假 > 改练:一天里既有请假条又有记录(请了假又练了),那天的事实是「练了」。
 */
export function weekDots(
  plan: TrainingPlan | null, logs: WorkoutLog[], notes: DayNotes, assigns: DayAssigns, today: string
): WeekDot[] {
  const mon = mondayOf(today);
  const dots: WeekDot[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    if (logs.some((l) => l.date === d)) dots.push({ d, s: 'done' });
    else if (isExcused(notes, d)) dots.push({ d, s: 'off' });
    else if (plan && assignOf(plan, assigns, d)) dots.push({ d, s: 'moved' });
  }
  return dots;
}

/**
 * 今天这一摊的现状 —— 写给主包首页的那张小抄(见 `utils/training-digest.ts`)。
 *
 * 判断**刻意和计划页共用同一批函数**(resolveDayKey / isExcused / 今天的日志):
 * 首页说「今天练推」而计划页高亮「拉」,就成了两个说法。
 */
export function todayDigest(
  plan: TrainingPlan | null, logs: WorkoutLog[], notes: DayNotes, assigns: DayAssigns, today: string
): TrainingSnapshot {
  const week = weekDots(plan, logs, notes, assigns, today);
  const empty: TrainingSnapshot = { state: 'none', dayKey: '', title: '', focus: '', estMin: 0, reassigned: false, week, items: [] };
  if (!plan?.days?.length) return empty;

  // 今天练过了就报「练的是哪一套」,不是「本来该练哪套」——
  // 后者会让首页把已经发生的事说得像还没发生。合并训练按日志自己的合成 key 说。
  const log = logs.find((l) => l.date === today);
  if (log) {
    const done = dayOfKey(plan, log.dayKey);
    return {
      ...empty,
      state: 'done',
      dayKey: log.dayKey,
      title: done?.title ?? log.dayTitle,
      focus: done?.focus ?? '',
      estMin: done?.estMin ?? 0,
      items: done ? done.items.map((it) => it.nameZh) : log.entries.map((e) => e.nameZh)
    };
  }

  const key = resolveDayKey(plan, logs, assigns, today);
  // 固定周的空格 / 轮转还没排 —— 都是「今天没有要练的」,但不是没有计划。
  // 首页那张卡该说「今天休息」,而不是拿第一套顶上(那会凭空催一次训练)。
  // 顺手把接下来第一个有安排的日子找出来 —— 休息日也有下一步,只是不在今天。
  if (!key) {
    let nextTitle = '';
    for (let i = 1; i <= 7; i++) {
      const next = dayForKeys(plan, scheduleDayKeys(plan, logs, addDays(today, i)));
      if (next) {
        nextTitle = next.title;
        break;
      }
    }
    return { ...empty, state: 'rest', title: nextTitle, week };
  }

  const day = dayOfKey(plan, key);
  if (!day) return { ...empty, state: 'rest', week };
  const base = {
    dayKey: key,
    title: day.title,
    focus: day.focus,
    estMin: day.estMin,
    reassigned: !!assignOf(plan, assigns, today),
    items: day.items.map((it) => it.nameZh)
  };
  if (isExcused(notes, today)) return { ...base, state: 'off', week };
  return { ...base, state: 'todo', week };
}
