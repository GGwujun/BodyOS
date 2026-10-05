import { Router } from 'express';
import { prisma } from '../db';
import { USER_ID } from '../lib/currentUser';
import { ok } from '../lib/http';
import { toDate, todayStr } from '../lib/date';
import { recomputeDaily } from '../engine';
import { summaryNeedsRefresh } from '../lib/summaryFreshness';

const router = Router();

/**
 * 今日重算去抖缓存:60s 内重复请求直接返回缓存,避免多页面并发触发全量重算。
 * 写入端点(增删食物/运动)不受此缓存影响 —— 它们直接调 recomputeDaily 并刷新 DB,
 * 下次 GET 会读到最新 recalculatedAt,缓存自动失效。
 */
const RECOMPUTE_TTL_MS = 60_000;
const recomputeCache = new Map<string, { at: number; summaryId: string }>();

function recentlyRecomputed(dateStr: string): boolean {
  const hit = recomputeCache.get(dateStr);
  return !!hit && Date.now() - hit.at < RECOMPUTE_TTL_MS;
}

/**
 * GET /daily-summary?date=YYYY-MM-DD
 * 当日无汇总,或今日(且 60s 内未重算)时触发重算后返回。
 */
router.get('/', async (req, res) => {
  const dateStr = (req.query.date as string) || todayStr();
  const date = toDate(dateStr);

  let summary = await prisma.dailySummary.findUnique({
    where: { userId_date: { userId: USER_ID, date } }
  });

  const isToday = dateStr === todayStr();
  const profile = await prisma.userProfile.findUnique({where:{userId:USER_ID},select:{updatedAt:true}});
  // 无汇总 → 必须重算;今日且超过 TTL → 重算保持新鲜;其余直接用缓存值
  if (summaryNeedsRefresh(summary?.recalculatedAt ?? null, profile?.updatedAt ?? null, isToday, recentlyRecomputed(dateStr))) {
    summary = await recomputeDaily(USER_ID, dateStr);
    recomputeCache.set(dateStr, { at: Date.now(), summaryId: summary.id });
  }

  const goal = await prisma.goal.findFirst({
    where: { userId: USER_ID, isActive: true },
    orderBy: { createdAt: 'desc' }
  });

  return ok(res, { ...summary, goal });
});

export default router;
