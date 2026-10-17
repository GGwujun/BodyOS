import { Router } from 'express';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok } from '../lib/http';
import { toDate, todayStr, toDateStr, addDays, ageFromBirth } from '../lib/date';
import { recomputeDaily } from '../engine';
import { calcBMR, calcTDEE } from '../engine/energy';
import { calcMacroTarget } from '../engine/nutrition';
import { hasEnergyProfile } from '../engine/dataAvailability';
import { countRecordedDays } from '../lib/recordedDays';
import { observedWeightChange } from '../lib/weightChange';
import { measurementWindow } from '../lib/trendWindow';

/**
 * GET /trends?range=7|30|90
 * 一次返回近 N 天的每日汇总 + 体重序列,供前端趋势页。
 * 今日(若缺失)触发重算保证新鲜。
 */
const trendsRouter = Router();

/**
 * DailySummary.nutrition 是 Json 列,老行的默认值里只有前三个字段,新字段是后来加的 ——
 * 形状统一在这儿收口,客户端不做兜底(它要是自己 `?? 0`,这层契约就等于没有)。
 */
function macroOf(raw: unknown): { proteinG: number; carbG: number; fatG: number } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  return { proteinG: n(o.proteinG), carbG: n(o.carbG), fatG: n(o.fatG) };
}

trendsRouter.get('/', async (req, res, next) => {
  try {
  const range = Math.min(90, Math.max(1, Number(req.query.range) || 7));
  const end = todayStr();
  const start = addDays(end, -(range - 1));
  const days = Array.from({ length: range }, (_, i) => toDate(addDays(start, i)));

  // 确保今天有汇总
  await recomputeDaily(getUserId(res), end);

  const [summaries, measurements, foodDates, activityDates, latestWeight, profile, goal] = await Promise.all([
    prisma.dailySummary.findMany({
      where: { userId: getUserId(res), date: { in: days } },
      orderBy: { date: 'asc' }
    }),
    prisma.bodyMeasurement.findMany({
      where: { userId: getUserId(res), measuredAt: measurementWindow(start, end) },
      orderBy: { measuredAt: 'asc' }
    }),
    prisma.foodLog.findMany({where:{userId:getUserId(res),deletedAt:null,date:{in:days}},select:{date:true},distinct:['date']}),
    prisma.activityRecord.findMany({where:{userId:getUserId(res),deletedAt:null,date:{in:days}},select:{date:true},distinct:['date']}),
    // 窗口外也要能显示"当前体重":取历史最新一条带体重的测量
    prisma.bodyMeasurement.findFirst({
      where: { userId: getUserId(res), weightKg: { not: null } },
      orderBy: { measuredAt: 'desc' }
    }),
    prisma.userProfile.findUnique({
      where: { userId: getUserId(res) },
      select: { weightKg: true, heightCm: true, gender: true, birthDate: true, activityLevel: true }
    }),
    // 宏量目标跟目标类型走(减脂的蛋白要求比维持高,见 engine/constants.PROTEIN_PER_KG)
    prisma.goal.findFirst({
      where: { userId: getUserId(res), isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { type: true, unit: true, targetValue: true }
    })
  ]);

  const weights = measurements
    .filter((m) => m.weightKg != null)
    .map((m) => ({ date: toDateStr(m.measuredAt), weightKg: m.weightKg as number }));

  /**
   * 每日宏量目标(该吃多少蛋白/碳水/脂肪)。
   *
   * 客户端只拿它做对比(「日均蛋白 82g / 目标 105g」),不自己算 —— 这个数取决于
   * 体重、目标类型和活动水平,公式在引擎里。资料不全时**返回 null 而不是按默认体重猜**:
   * 猜出来的目标会让用户以为 App 知道该吃多少,而它其实只知道个身高都没有。
   */
  const energyProfile = {
    gender: (profile?.gender ?? '') as string,
    age: ageFromBirth(profile?.birthDate ?? null),
    heightCm: profile?.heightCm ?? null,
    weightKg: profile?.weightKg ?? null
  };
  const macroTarget =
    goal && hasEnergyProfile(energyProfile)
      ? (() => {
          const tdee = calcTDEE(calcBMR(energyProfile as { gender: string; age: number; heightCm: number; weightKg: number }), profile?.activityLevel ?? 'moderate');
          const t = calcMacroTarget({ tdee, goalType: goal.type, weightKg: energyProfile.weightKg as number });
          return {
            calories: Math.round(t.targetCalories),
            proteinG: Math.round(t.targetProteinG),
            carbG: Math.round(t.targetCarbG),
            fatG: Math.round(t.targetFatG)
          };
        })()
      : null;

  // 聚合统计
  const currentWeight =
    weights[weights.length - 1]?.weightKg ?? latestWeight?.weightKg ?? profile?.weightKg ?? null;
  const validScores = summaries.filter((s) => s.bodyScore != null);
  const avgScore =
    validScores.length > 0
      ? validScores.reduce((s, x) => s + x.bodyScore!, 0) / validScores.length
      : null;

  return ok(res, {
    range,
    summaries: summaries.map((s) => ({
      date: toDateStr(s.date),
      bodyScore: s.bodyScore,
      energyScore: s.energyScore,
      nutritionScore: s.nutritionScore,
      activityScore: s.activityScore,
      recoveryScore: s.recoveryScore,
      goalScore: s.goalScore,
      intakeCalories: s.intakeCalories,
      burnCalories: s.burnCalories,
      netCalories: s.netCalories,
      steps: s.steps,
      nutrition: macroOf(s.nutrition)
    })),
    weights,
    macroTarget,
    // 趋势页要按目标方向决定「掉秤」是好事还是坏事(增肌掉秤不该标绿)
    goal,
    stats: {
      avgScore: avgScore == null ? null : Math.round(avgScore),
      currentWeight,
      weightChange: observedWeightChange(weights.map(row=>row.weightKg)),
      recordDays: countRecordedDays(
        foodDates.map(row=>toDateStr(row.date)),
        activityDates.map(row=>toDateStr(row.date)),
        measurements.map(row=>toDateStr(row.measuredAt))
      )
    }
  });
  } catch (error) {
    next(error);
  }
});

export default trendsRouter;
