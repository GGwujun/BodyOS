import { Router } from 'express';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok } from '../lib/http';
import { toDate, todayStr, toDateStr, addDays } from '../lib/date';
import { recomputeDaily } from '../engine';
import { countRecordedDays } from '../lib/recordedDays';
import { observedWeightChange } from '../lib/weightChange';
import { measurementWindow } from '../lib/trendWindow';

/**
 * GET /trends?range=7|30|90
 * 一次返回近 N 天的每日汇总 + 体重序列,供前端趋势页。
 * 今日(若缺失)触发重算保证新鲜。
 */
const trendsRouter = Router();

trendsRouter.get('/', async (req, res, next) => {
  try {
  const range = Math.min(90, Math.max(1, Number(req.query.range) || 7));
  const end = todayStr();
  const start = addDays(end, -(range - 1));
  const days = Array.from({ length: range }, (_, i) => toDate(addDays(start, i)));

  // 确保今天有汇总
  await recomputeDaily(getUserId(res), end);

  const [summaries, measurements, foodDates, activityDates] = await Promise.all([
    prisma.dailySummary.findMany({
      where: { userId: getUserId(res), date: { in: days } },
      orderBy: { date: 'asc' }
    }),
    prisma.bodyMeasurement.findMany({
      where: { userId: getUserId(res), measuredAt: measurementWindow(start, end) },
      orderBy: { measuredAt: 'asc' }
    }),
    prisma.foodLog.findMany({where:{userId:getUserId(res),deletedAt:null,date:{in:days}},select:{date:true},distinct:['date']}),
    prisma.activityRecord.findMany({where:{userId:getUserId(res),deletedAt:null,date:{in:days}},select:{date:true},distinct:['date']})
  ]);

  const weights = measurements
    .filter((m) => m.weightKg != null)
    .map((m) => ({ date: toDateStr(m.measuredAt), weightKg: m.weightKg as number }));

  // 聚合统计
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
      steps: s.steps
    })),
    weights,
    stats: {
      avgScore: avgScore == null ? null : Math.round(avgScore),
      currentWeight: weights[weights.length - 1]?.weightKg ?? null,
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
