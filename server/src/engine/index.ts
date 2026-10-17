import { prisma } from '../db';
import { addDays, ageFromBirth, endOfLocalDay, startOfLocalDay, toDate, todayStr, toDateStr } from '../lib/date';
import { ENGINE_VERSION } from './constants';
import { calcEnergy } from './energy';
import { calcMacroTarget, nutritionScore, type NutritionAggregate } from './nutrition';
import { goalProgress, goalScore, weightTrend, type WeightPoint } from './goal';
import { bodyScore } from './score';
import { hasEnergyProfile } from './dataAvailability';

export { ENGINE_VERSION };

type GoalRow = { id: string; type: string; targetValue: number; unit: string; startDate: Date } | null;

/**
 * 目标进度快照 —— 起始体重取「目标日开始前最后一条」,当前体重取「到当天为止最新一条」。
 *
 * 以前两处都只看近 14 天窗口:目标开始得早、或者 14 天里没称过,起始/当前就会
 * 退化成窗口边缘那两条,进度凭空跳到 0 或 100。这里各查一条锚点,不拉整段历史。
 *
 * 同时把结果写回 `Goal.progress`(0-100):首页那张目标卡读的就是这一列,
 * 而这个列以前从没人写过,恒为 0。
 */
async function goalProgressFor(
  userId: string,
  goal: GoalRow,
  endOfDay: Date,
  weightPoints: WeightPoint[],
  effectiveWeight: number
): Promise<{ startWeight: number; currentWeight: number; progress: number }> {
  const goalStartStr = goal ? toDateStr(goal.startDate) : null;
  const [startBefore, startAfter, latestWeight] = await Promise.all([
    goalStartStr
      ? prisma.bodyMeasurement.findFirst({
          where: { userId, weightKg: { not: null }, measuredAt: { lt: endOfLocalDay(goalStartStr) } },
          orderBy: { measuredAt: 'desc' }
        })
      : null,
    goalStartStr
      ? prisma.bodyMeasurement.findFirst({
          where: { userId, weightKg: { not: null }, measuredAt: { gte: endOfLocalDay(goalStartStr), lt: endOfDay } },
          orderBy: { measuredAt: 'asc' }
        })
      : null,
    prisma.bodyMeasurement.findFirst({
      where: { userId, weightKg: { not: null }, measuredAt: { lt: endOfDay } },
      orderBy: { measuredAt: 'desc' }
    })
  ]);
  const startWeight = startBefore?.weightKg ?? startAfter?.weightKg ?? weightPoints[0]?.weightKg ?? effectiveWeight;
  const currentWeight = latestWeight?.weightKg ?? weightPoints[weightPoints.length - 1]?.weightKg ?? effectiveWeight;

  // 维持/耐力目标的目标值不是「还要减/增多少公斤」,套减脂公式只会得到一个假进度
  const changeByKg = goal != null && goal.unit === 'kg' && (goal.type === 'fat_loss' || goal.type === 'muscle_gain');
  const progress = changeByKg
    ? goalProgress({
        type: goal!.type,
        startValue: startWeight,
        currentValue: currentWeight,
        targetChange: goal!.targetValue
      })
    : 0;

  if (goal) {
    await prisma.goal.update({
      where: { id: goal.id },
      data: { progress: Math.round(progress * 100) }
    });
  }
  return { startWeight, currentWeight, progress };
}

/**
 * 重算某用户某天的 DailySummary,并 upsert。
 * 食物/运动增删、同步、体重测量后调用。
 */
export async function recomputeDaily(userId: string, dateStr = todayStr()) {
  const date = toDate(dateStr);

  // 1-3,5,6 并行查询(消除串行等待);连续记录天数一次查 distinct date(消除逐天 N+1)
  // measuredAt 是真实瞬时值,窗口边界要用**本地日界**:以前写 `lte: date`
  // (UTC 零点),在东八区等于把当天 08:00 之后的称重全部排除在趋势/进度之外。
  const fourteenAgo = startOfLocalDay(addDays(dateStr, -14));
  const endOfDay = endOfLocalDay(dateStr);
  const [profile, foodLogs, activities, goal, measurements, recentFoodRows, waterLog] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.foodLog.findMany({ where: { userId, date, deletedAt: null } }),
    prisma.activityRecord.findMany({ where: { userId, date, deletedAt: null } }),
    prisma.goal.findFirst({ where: { userId, isActive: true }, orderBy: { createdAt: 'desc' } }),
    prisma.bodyMeasurement.findMany({
      where: { userId, measuredAt: { gte: fourteenAgo, lt: endOfDay } },
      orderBy: { measuredAt: 'asc' }
    }),
    prisma.foodLog.findMany({
      where: { userId, deletedAt: null, date: { gte: fourteenAgo, lte: date } },
      select: { date: true },
      distinct: ['date']
    }),
    prisma.waterLog.findUnique({ where: { userId_date: { userId, date } } })
  ]);

  const gender = profile?.gender ?? 'male';
  const age = ageFromBirth(profile?.birthDate ?? null);
  const heightCm = profile?.heightCm ?? null;
  const weightKg = profile?.weightKg ?? null;
  const activityLevel = profile?.activityLevel ?? 'moderate';
  const effectiveWeight = weightKg ?? 65;

  const intakeCalories = foodLogs.reduce((s, f) => s + f.totalCalories, 0);
  const nutrition: NutritionAggregate = foodLogs.reduce(
    (acc, f) => ({
      proteinG: acc.proteinG + f.proteinG,
      carbG: acc.carbG + f.carbG,
      fatG: acc.fatG + f.fatG,
      fiberG: acc.fiberG + f.fiberG
    }),
    { proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 }
  );

  // 活动:无 durationMin 视为日常活动(步数衍生),有 durationMin 视为正式运动
  const steps = activities.reduce((s, a) => s + (a.steps ?? 0), 0);
  const activeCalories = activities
    .filter((a) => !a.durationMin)
    .reduce((s, a) => s + a.calories, 0);
  const formalExercises = activities.filter((a) => a.durationMin);
  const exerciseMin = formalExercises.reduce((s, a) => s + (a.durationMin ?? 0), 0);
  const exerciseCalories = formalExercises.reduce((s, a) => s + a.calories, 0);

  // 目标进度只依赖体重记录,不依赖今天有没有吃饭/运动 ——
  // 放在「没有能量数据就提前返回」之前,单称了一次体重也能让首页目标卡动起来。
  const weightPoints: WeightPoint[] = measurements
    .filter((m) => m.weightKg != null)
    .map((m) => ({ date: toDateStr(m.measuredAt), weightKg: m.weightKg as number }));
  const trend = weightTrend(weightPoints);
  const { progress } = await goalProgressFor(userId, goal, endOfDay, weightPoints, effectiveWeight);

  if (!hasEnergyProfile({gender,age,heightCm,weightKg}) || (!foodLogs.length && !activities.length)) {
    const observed = {
      bodyScore:null,energyScore:null,nutritionScore:null,activityScore:null,recoveryScore:null,goalScore:null,
      intakeCalories,burnCalories:null,netCalories:null,bmr:null,tdee:null,
      steps,activeCalories,exerciseCalories,waterMl:waterLog?.amountMl ?? 0,
      nutrition,engineVersion:ENGINE_VERSION,recalculatedAt:new Date()
    };
    return prisma.dailySummary.upsert({
      where:{userId_date:{userId,date}},create:{userId,date,...observed},update:observed
    });
  }

  const energy = calcEnergy({
    gender,
    age,
    heightCm,
    weightKg: effectiveWeight,
    activityLevel,
    intakeCalories,
    activeCalories,
    exerciseCalories
  });

  const goalType = goal?.type ?? 'maintain';
  const macroTarget = calcMacroTarget({ tdee: energy.tdee, goalType, weightKg: effectiveWeight });
  const targetNetCalories = macroTarget.targetCalories - energy.burnCalories;

  const gScore = goal
    ? goalScore({ progress, trend, type: goal.type, isActive: true })
    : 70;

  // 连续记录天数:基于已查到的近14天 distinct 日期,从目标日往前数连续(消除逐天 N+1)
  const recordedDateSet = new Set(recentFoodRows.map((r) => toDateStr(r.date)));
  let consecutiveDays = 0;
  for (let d = 0; d < 14; d++) {
    const dayStr = toDateStr(new Date(date.getTime() - d * 86400_000));
    if (recordedDateSet.has(dayStr)) consecutiveDays++;
    else break;
  }
  const hasRecentRecords = consecutiveDays >= 2;

  // 体重波动:近7天体重日间最大变动幅度(%)
  const recentWeights = weightPoints.slice(-7).map((p) => p.weightKg);
  let weightVolatilityPct = 0;
  if (recentWeights.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < recentWeights.length; i++) {
      diffs.push((Math.abs(recentWeights[i] - recentWeights[i - 1]) / recentWeights[i - 1]) * 100);
    }
    weightVolatilityPct = diffs.length ? Math.max(...diffs) : 0;
  }

  // 7. 综合评分
  const nScore = nutritionScore(nutrition, macroTarget);
  const scores = bodyScore({
    netCalories: energy.netCalories,
    targetNetCalories,
    targetCalories: macroTarget.targetCalories,
    nutritionScore: nScore,
    steps,
    exerciseMin,
    goalScore: gScore,
    hasRecentRecords,
    consecutiveDays,
    weightVolatilityPct
  });

  // 8. upsert DailySummary
  const summary = await prisma.dailySummary.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId, date,
      bodyScore: scores.bodyScore, energyScore: scores.energyScore,
      nutritionScore: scores.nutritionScore, activityScore: scores.activityScore,
      recoveryScore: scores.recoveryScore, goalScore: scores.goalScore,
      intakeCalories, burnCalories: energy.burnCalories, netCalories: energy.netCalories,
      bmr: energy.bmr, tdee: energy.tdee,
      steps, activeCalories, exerciseCalories, waterMl: waterLog?.amountMl ?? 0,
      nutrition, engineVersion: ENGINE_VERSION, recalculatedAt: new Date()
    },
    update: {
      bodyScore: scores.bodyScore, energyScore: scores.energyScore,
      nutritionScore: scores.nutritionScore, activityScore: scores.activityScore,
      recoveryScore: scores.recoveryScore, goalScore: scores.goalScore,
      intakeCalories, burnCalories: energy.burnCalories, netCalories: energy.netCalories,
      bmr: energy.bmr, tdee: energy.tdee,
      steps, activeCalories, exerciseCalories, waterMl: waterLog?.amountMl ?? 0,
      nutrition, engineVersion: ENGINE_VERSION, recalculatedAt: new Date()
    }
  });

  return summary;
}
