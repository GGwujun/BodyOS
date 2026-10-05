import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { USER_ID } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { toDate, todayStr } from '../lib/date';

const router = Router();

const TrackSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['activation', 'home', 'ai', 'datasource', 'other']).default('other'),
  props: z.record(z.unknown()).optional()
});

/** POST /analytics/track — 单条事件 */
router.post('/track', async (req, res) => {
  const parsed = TrackSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');
  const event = await prisma.analyticsEvent.create({
    data: {
      userId: USER_ID,
      name: parsed.data.name,
      category: parsed.data.category,
      props: (parsed.data.props ?? null) as never
    }
  });
  return ok(res, event);
});

/** POST /analytics/track-batch — 批量上报(减少请求次数) */
router.post('/track-batch', async (req, res) => {
  const arr = z.array(TrackSchema).safeParse(req.body);
  if (!arr.success) return err(res, 400, '参数错误');
  await prisma.analyticsEvent.createMany({
    data: arr.data.map((e) => ({
      userId: USER_ID,
      name: e.name,
      category: e.category,
      props: (e.props ?? null) as never
    }))
  });
  return ok(res, { accepted: arr.data.length });
});

/**
 * GET /analytics/metrics — 关键产品指标(docs/03)
 * D1/D7 留存、每周有效记录天数、AI 采纳率/确认率、同步成功率、首页复访率。
 */
router.get('/metrics', async (_req, res) => {
  const today = toDate(todayStr());
  const day1 = new Date(today);
  day1.setDate(day1.getDate() - 1);
  const day7 = new Date(today);
  day7.setDate(day7.getDate() - 7);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [activation, d1Active, d7Active, weekFoodDays, aiParses, aiConfirms, aiAdopts, syncSuccess, syncErrors, homeViews] =
    await Promise.all([
      count('onboarding_complete'),
      prisma.analyticsEvent.count({ where: { name: 'home_view', occurredAt: { gte: day1 } } }),
      prisma.analyticsEvent.count({ where: { name: 'home_view', occurredAt: { gte: day7 } } }),
      prisma.foodLog.groupBy({
        by: ['date'],
        where: { userId: USER_ID, deletedAt: null, date: { gte: weekAgo } },
        _count: { _all: true }
      }),
      countSince('ai_food_parse_start', weekAgo),
      countSince('ai_food_parse_confirm', weekAgo),
      countSince('daily_action_click', weekAgo),
      countSince('datasource_sync_success', weekAgo),
      countSince('datasource_sync_error', weekAgo),
      countSince('home_view', weekAgo)
    ]);

  async function count(name: string) {
    return prisma.analyticsEvent.count({ where: { name } });
  }
  async function countSince(name: string, since: Date) {
    return prisma.analyticsEvent.count({ where: { name, occurredAt: { gte: since } } });
  }

  // 每周有效记录天数(至少1条食物)
  const activeRecordDays = new Set(weekFoodDays.map((d) => d.date.toISOString())).size;

  const metrics = {
    onboardingComplete: activation,
    retentionD1: d1Active,
    retentionD7: d7Active,
    weeklyActiveRecordDays: activeRecordDays,
    aiParseAttempts: aiParses,
    aiConfirmRate: aiParses > 0 ? +(aiConfirms / aiParses).toFixed(2) : 0,
    aiAdoptionRate: homeViews > 0 ? +(aiAdopts / homeViews).toFixed(2) : 0,
    syncSuccessRate: syncSuccess + syncErrors > 0 ? +(syncSuccess / (syncSuccess + syncErrors)).toFixed(2) : 0,
    homeReturnRate: homeViews
  };

  return ok(res, metrics);
});

export default router;
