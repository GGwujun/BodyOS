import { Router } from 'express';
import { ProfileSchema } from '../lib/profileValidation';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';
import { clearTodayWeightMeasurement, syncWeightMeasurement } from '../lib/weightSync';
import { recomputeDaily } from '../engine';

const router = Router();

async function ensureProfile(userId: string) {
  return (
    (await prisma.userProfile.findUnique({ where: { userId } })) ??
    (await prisma.userProfile.create({ data: { userId, gender: 'other' } }))
  );
}

/** GET /profile */
router.get('/', wrap(async (_req, res) => {
  const profile = await ensureProfile(getUserId(res));
  return ok(res, profile);
}));

/** PUT /profile */
router.put('/', wrap(async (req, res) => {
  const parsed = ProfileSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, parsed.error.issues[0]?.message || '参数错误');
  const userId = getUserId(res);
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.birthDate) data.birthDate = new Date(parsed.data.birthDate);

  const before = await prisma.userProfile.findUnique({ where: { userId } });
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, gender:'other', ...data } as never,
    update: data as never
  });

  // 只有**体重真的变了**才碰今天的测量:
  // 改身高/生日也带着同一个体重提交过一次,每次都同步会把今天这个点的时间刷新,
  // 同一天的曲线反复挪位置;清空体重则要把今天那笔同步出来的测量一起清掉。
  const weightChanged = 'weightKg' in parsed.data && parsed.data.weightKg !== (before?.weightKg ?? null);
  if (weightChanged) {
    if (parsed.data.weightKg != null) await syncWeightMeasurement(userId, parsed.data.weightKg);
    else await clearTodayWeightMeasurement(userId);
  }

  // 体重/身高/年龄/活动量都会改变 BMR/TDEE;今日汇总下一次读取要拿到新值
  if (weightChanged || ['heightCm', 'birthDate', 'gender', 'activityLevel'].some((k) => k in parsed.data)) {
    await recomputeDaily(userId);
  }

  return ok(res, profile);
}));

export default router;
