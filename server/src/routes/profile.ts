import { Router } from 'express';
import { ProfileSchema } from '../lib/profileValidation';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';
import { syncWeightMeasurement } from '../lib/weightSync';

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
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.birthDate) data.birthDate = new Date(parsed.data.birthDate);

  const profile = await prisma.userProfile.upsert({
    where: { userId: getUserId(res) },
    create: { userId: getUserId(res), gender:'other', ...data } as never,
    update: data as never
  });

  // 资料里保存了体重 → 同步落当天的身体测量,让趋势/体重页有据可查
  if (parsed.data.weightKg != null) {
    await syncWeightMeasurement(getUserId(res), parsed.data.weightKg);
  }

  return ok(res, profile);
}));

export default router;
