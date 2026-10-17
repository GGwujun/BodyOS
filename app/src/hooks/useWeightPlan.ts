import { useAsync } from './useAsync';
import { bodyApi, userApi } from '@/services';
import { addDays, localDayOf } from '@/utils/date';
import type { BodyMeasurement, Goal, Profile } from '@/services/types';

export interface WeightRecord {
  date: string;   // YYYY-MM-DD
  weightKg: number;
}

export interface WeightPlan {
  profile: Profile | undefined;
  /** 进行中的目标(可能没有) */
  goal: Goal | null;
  /** 体重记录(按日期升序) */
  records: WeightRecord[];
  /** 目标开始时的体重(取目标日前最近一条记录,无则回落首次记录/资料体重) */
  startWeight: number | null;
  /** 最新体重 */
  latestWeight: number | null;
  /** 目标体重(维持型目标即其目标值本身) */
  targetWeight: number | null;
  /** -1 减重 / +1 增重 / 0 维持或非体重目标 */
  direction: -1 | 0 | 1;
  /** 方向化文案:减重 / 增重 / 维持 */
  dirLabel: string;
  /** 已完成变化量(公斤,方向化;反向变化为负) */
  doneKg: number;
  /** 目标完成百分比 0-100;维持/非体重目标为 null */
  progressPct: number | null;
  /** 每周目标变化量(公斤) */
  weeklyKg: number | null;
  /** 预计完成日 YYYY-MM-DD */
  endDate: string | null;
  goalStart: string | null;
}

function planKgOf(goal: Goal | null): number | null {
  if (!goal || goal.unit !== 'kg') return null;
  return goal.targetValue > 0 ? goal.targetValue : null;
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

function derive(
  profile: Profile | undefined,
  goals: Goal[] | undefined,
  items: BodyMeasurement[] | undefined
): WeightPlan {
  const goal = goals?.[0] ?? null;
  const records = (items ?? [])
    .filter((m) => m.weightKg != null && m.weightKg > 0)
    // 日期一律走 localDayOf:measuredAt/startDate 都是 UTC 时间戳,
    // 直接切前 10 位的话,早上称的那一笔会被分到昨天(周均值也会算进上一周)
    .map((m) => ({ date: localDayOf(m.measuredAt), at: Date.parse(m.measuredAt), weightKg: m.weightKg as number }))
    // 同一天称了两次时,再按 measuredAt 排。接口是「最新在前」,
    // 只按 date 排的话稳定排序会把同一天的顺序原样保留,末项反而是早上那条 ——
    // 晚上称的 69kg 被早上 70kg 盖掉,「最新体重」和进度都回到早上的数。
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at - b.at))
    .map(({ date, weightKg }) => ({ date, weightKg }));

  const goalStart = goal ? localDayOf(goal.startDate) : null;
  const latestWeight = records.length ? records[records.length - 1].weightKg : (profile?.weightKg ?? null);

  // 初始体重:目标日当天/之前最近一条;目标开始后才首测的,取目标期内首条;再回落资料体重
  let startWeight: number | null = null;
  if (goalStart) {
    const before = records.filter((r) => r.date <= goalStart);
    const after = records.filter((r) => r.date > goalStart);
    startWeight = before.length ? before[before.length - 1].weightKg
      : after.length ? after[0].weightKg
      : (profile?.weightKg ?? null);
  }

  const planKg = planKgOf(goal);
  let direction: -1 | 0 | 1 = 0;
  if (goal?.type === 'fat_loss') direction = -1;
  else if (goal?.type === 'muscle_gain') direction = 1;

  const isChangeGoal = direction !== 0 && planKg != null;
  const targetWeight = isChangeGoal && startWeight != null
    ? Math.round((startWeight + direction * planKg) * 10) / 10
    : goal?.type === 'maintain' && planKg != null ? planKg : null;

  const doneKg = isChangeGoal && startWeight != null && latestWeight != null
    ? Math.round((latestWeight - startWeight) * -direction * 10) / 10
    : 0;
  const progressPct = isChangeGoal && planKg != null
    ? clamp(Math.round((doneKg / planKg) * 100), 0, 100)
    : null;
  const weeklyKg = isChangeGoal && goal?.durationWeeks
    ? Math.round((planKg / goal.durationWeeks) * 100) / 100
    : null;
  const endDate = goal?.durationWeeks && goalStart
    ? addDays(goalStart, goal.durationWeeks * 7)
    : null;

  return {
    profile, goal, records, startWeight, latestWeight, targetWeight,
    direction,
    dirLabel: direction === 1 ? '增重' : direction === -1 ? '减重' : '维持',
    doneKg, progressPct, weeklyKg, endDate, goalStart
  };
}

/** 体重方案数据:资料 + 进行中目标 + 体重记录 → 进度推导(体重数据页/方案页共用) */
export function useWeightPlan() {
  const { data, loading, error, refresh } = useAsync(async () => {
    const [profile, goals] = await Promise.all([
      userApi.getProfile(),
      userApi.listGoals()
    ]);
    // 翻完所有页:目标开始那段可能在 100 条之外。只取第一页时,记录一多
    // 起始体重就会退化成「最近 100 条里最早那条」,初始/目标体重和进度一起漂。
    const items: BodyMeasurement[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await bodyApi.listBodyMeasurements({ page, pageSize: 100 });
      items.push(...r.items);
      if (r.items.length < 100 || page * 100 >= r.total) break;
    }
    return derive(profile, goals, items);
  }, []);
  return { plan: data, loading, error, refresh };
}
