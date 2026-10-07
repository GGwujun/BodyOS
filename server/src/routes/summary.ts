import { Router } from 'express';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { toDate, todayStr, isValidDateStr } from '../lib/date';
import { recomputeDaily } from '../engine';
import { summaryNeedsRefresh } from '../lib/summaryFreshness';
import { wrap } from '../lib/asyncHandler';

const router = Router();

/**
 * 今日重算去抖缓存:60s 内重复请求直接返回缓存,避免多页面并发触发全量重算。
 * 写入端点(增删食物/运动)不受此缓存影响 —— 它们直接调 recomputeDaily 并刷新 DB,
 * 下次 GET 会读到最新 recalculatedAt,缓存自动失效。
 * key 必须含 userId:只按日期缓存会把 A 用户刚算完的汇总错给 B 用户(串数据)。
 */
const RECOMPUTE_TTL_MS = 60_000;
const recomputeCache = new Map<string, { at: number }>();

function recentlyRecomputed(userId: string, dateStr: string): boolean {
  const hit = recomputeCache.get(`${userId}:${dateStr}`);
  return !!hit && Date.now() - hit.at < RECOMPUTE_TTL_MS;
}

/**
 * GET /daily-summary?date=YYYY-MM-DD
 * 当日无汇总,或今日(且 60s 内未重算)时触发重算后返回。
 */
router.get('/', wrap(async (req, res) => {
  const dateStr = (req.query.date as string) || todayStr();
  if (!isValidDateStr(dateStr)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  const date = toDate(dateStr);
  const userId = getUserId(res);

  let summary = await prisma.dailySummary.findUnique({
    where: { userId_date: { userId, date } }
  });

  const isToday = dateStr === todayStr();
  const profile = await prisma.userProfile.findUnique({where:{userId},select:{updatedAt:true}});
  // 无汇总 → 必须重算;今日且超过 TTL → 重算保持新鲜;其余直接用缓存值
  if (summaryNeedsRefresh(summary?.recalculatedAt ?? null, profile?.updatedAt ?? null, isToday, recentlyRecomputed(userId, dateStr))) {
    summary = await recomputeDaily(userId, dateStr);
    if (recomputeCache.size > 5000) recomputeCache.clear(); // 容量保护:正常量级(用户×日期)远达不到
    recomputeCache.set(`${userId}:${dateStr}`, { at: Date.now() });
  }

  const goal = await prisma.goal.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'desc' }
  });

  return ok(res, { ...summary, goal });
}));

export default router;
