import { Router } from 'express';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { toDate, todayStr, isValidDateStr, ageFromBirth } from '../lib/date';
import { recomputeDaily } from '../engine';
import { missingEnergyFields } from '../engine/dataAvailability';
import { macroTargetView } from '../engine/nutrition';
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
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { updatedAt: true, birthDate: true, heightCm: true, weightKg: true, gender: true, activityLevel: true, stepGoal: true }
  });
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

  /**
   * 分数/消耗为空时,客户端得说得出**为什么**:
   * 「记录饮食、运动后可查看」对没填身高体重的人是句错话 —— 他记了也不会有。
   * 这里把还缺哪几项一并返回,首页据此把用户直接送去补资料。
   */
  const missingProfile = missingEnergyFields({
    age: ageFromBirth(profile?.birthDate ?? null),
    heightCm: profile?.heightCm ?? null,
    weightKg: profile?.weightKg ?? null
  });

  /**
   * 每日宏量目标 —— 和 /trends 同一份公式(engine/nutrition.macroTargetView)。
   * 饮食页的「今天的营养」卡要拿它对当日摄入,不能只在趋势页给回顾视角。
   * goal 的 type 直接用上面查到的那条 active goal。
   */
  const macroTarget = goal
    ? macroTargetView(
        {
          gender: (profile?.gender ?? '') as string,
          age: ageFromBirth(profile?.birthDate ?? null),
          heightCm: profile?.heightCm ?? null,
          weightKg: profile?.weightKg ?? null
        },
        profile?.activityLevel ?? 'moderate',
        goal.type
      )
    : null;

  return ok(res, { ...summary, goal, profileReady: missingProfile.length === 0, missingProfile, macroTarget, stepGoal: profile?.stepGoal ?? 8000 });
}));

export default router;
