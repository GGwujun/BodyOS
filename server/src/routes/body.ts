import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { USER_ID } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { parsePage, pageResult } from '../lib/pagination';

const router = Router();

export const CreateBodySchema = z.object({
  measuredAt: z.string().datetime().refine(value => new Date(value).getTime() <= Date.now(), '测量时间不能晚于当前时间'),
  weightKg: z.number().finite().positive('体重必须大于 0').nullable().optional(),
  bodyFatPct: z.number().finite().min(0).max(100).nullable().optional(),
  muscleKg: z.number().finite().nonnegative().nullable().optional()
}).refine(value => [value.weightKg, value.bodyFatPct, value.muscleKg].some(item => item != null), '至少填写一项身体测量数据');

/** GET /body-measurements */
router.get('/', async (req, res, next) => {
  try {
  const q = parsePage(req);
  const where = { userId: USER_ID };
  const [items, total] = await Promise.all([
    prisma.bodyMeasurement.findMany({
      where,
      orderBy: { measuredAt: 'desc' },
      skip: q.skip,
      take: q.take
    }),
    prisma.bodyMeasurement.count({ where })
  ]);
  return ok(res, pageResult(items, total, q));
  } catch (error) { next(error); }
});

/** POST /body-measurements — 若有体重,同步更新 UserProfile.weightKg(让 TDEE 用最新体重) */
router.post('/', async (req, res, next) => {
  const parsed = CreateBodySchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, parsed.error.issues[0]?.message || '参数错误', { affectsData: false });

  try {
  const createMeasurement = prisma.bodyMeasurement.create({
    data: {
      userId: USER_ID,
      measuredAt: new Date(parsed.data.measuredAt),
      weightKg: parsed.data.weightKg ?? null,
      bodyFatPct: parsed.data.bodyFatPct ?? null,
      muscleKg: parsed.data.muscleKg ?? null
    }
  });

  const updateProfile = parsed.data.weightKg != null ? prisma.userProfile.upsert({
      where: { userId: USER_ID },
      create: { userId: USER_ID, weightKg: parsed.data.weightKg },
      update: { weightKg: parsed.data.weightKg }
    }) : null;
  const [measurement] = updateProfile
    ? await prisma.$transaction([createMeasurement, updateProfile])
    : await prisma.$transaction([createMeasurement]);

  return ok(res, measurement);
  } catch (error) { next(error); }
});

/** DELETE /body-measurements/:id — 删除单次测量 */
router.delete('/:id', async (req, res, next) => {
  try {
  const m = await prisma.bodyMeasurement.findUnique({ where: { id: req.params.id } });
  if (!m || m.userId !== USER_ID) {
    return err(res, 404, '记录不存在', { affectsData: false });
  }
  await prisma.bodyMeasurement.delete({ where: { id: req.params.id } });
  return ok(res, { deleted: true });
  } catch (error) { next(error); }
});

export default router;
