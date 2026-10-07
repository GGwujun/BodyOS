import { useAsync } from './useAsync';
import { bodyApi, userApi } from '@/services';
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

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    .map((m) => ({ date: m.measuredAt.slice(0, 10), weightKg: m.weightKg as number }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const goalStart = goal ? goal.startDate.slice(0, 10) : null;
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
    ? addDaysStr(goalStart, goal.durationWeeks * 7)
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
    const [profile, goals, measurements] = await Promise.all([
      userApi.getProfile(),
      userApi.listGoals(),
      bodyApi.listBodyMeasurements({ pageSize: 100 })
    ]);
    return derive(profile, goals, measurements.items);
  }, []);
  return { plan: data, loading, error, refresh };
}
