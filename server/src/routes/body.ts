import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { parsePage, pageResult } from '../lib/pagination';
import { todayStr, toDateStr } from '../lib/date';
import { recomputeDaily } from '../engine';

const router = Router();

/** 围度字段同名同规则:厘米,10-300 之间(量错一位数能挡掉) */
const girth = () => z.number().finite().min(10, '围度看起来不对').max(300, '围度看起来不对').nullable().optional();

export const CreateBodySchema = z.object({
  measuredAt: z.string().datetime().refine(value => new Date(value).getTime() <= Date.now(), '测量时间不能晚于当前时间'),
  // 和资料里的体重同一个范围:以前这里只挡 >0,450kg 能直接写进档案,
  // 再被 BMR 拿去做公式,整页热量目标跟着离谱
  weightKg: z.number().finite().min(20, '体重看起来不对').max(400, '体重超出合理范围').nullable().optional(),
  bodyFatPct: z.number().finite().min(0).max(100).nullable().optional(),
  muscleKg: z.number().finite().nonnegative().nullable().optional(),
  waistCm: girth(),
  chestCm: girth(),
  hipCm: girth(),
  armCm: girth(),
  thighCm: girth()
}).refine(
  value => [value.weightKg, value.bodyFatPct, value.muscleKg, value.waistCm, value.chestCm, value.hipCm, value.armCm, value.thighCm]
    .some(item => item != null),
  '至少填写一项身体测量数据'
);

/** GET /body-measurements */
router.get('/', async (req, res, next) => {
  try {
  const q = parsePage(req);
  const where = { userId: getUserId(res) };
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
  const userId = getUserId(res);
  const measuredAt = new Date(parsed.data.measuredAt);
  const weightKg = parsed.data.weightKg ?? null;

  // 只有「这条确实是当前最新体重」时才回写档案。
  // 补录三个月前的一次称重不该把现在的档案改成三个月前的数 —— 以前不论时间一律覆盖,
  // 补一条历史记录就能让 TDEE/热量目标整体退回旧体重。
  const latest = weightKg != null
    ? await prisma.bodyMeasurement.findFirst({
        where: { userId, weightKg: { not: null } },
        orderBy: { measuredAt: 'desc' }
      })
    : null;
  const shouldSyncProfile = weightKg != null && (!latest || measuredAt.getTime() >= latest.measuredAt.getTime());

  const createMeasurement = prisma.bodyMeasurement.create({
    data: {
      userId,
      measuredAt,
      weightKg,
      bodyFatPct: parsed.data.bodyFatPct ?? null,
      muscleKg: parsed.data.muscleKg ?? null,
      waistCm: parsed.data.waistCm ?? null,
      chestCm: parsed.data.chestCm ?? null,
      hipCm: parsed.data.hipCm ?? null,
      armCm: parsed.data.armCm ?? null,
      thighCm: parsed.data.thighCm ?? null
    }
  });

  const updateProfile = shouldSyncProfile ? prisma.userProfile.upsert({
      where: { userId },
      create: { userId, weightKg },
      update: { weightKg }
    }) : null;
  const [measurement] = updateProfile
    ? await prisma.$transaction([createMeasurement, updateProfile])
    : await prisma.$transaction([createMeasurement]);

  const day = toDateStr(measuredAt);
  await recomputeDaily(userId, day);
  if (day !== todayStr()) await recomputeDaily(userId, todayStr());

  return ok(res, measurement);
  } catch (error) { next(error); }
});

/** DELETE /body-measurements/:id — 删除单次测量 */
router.delete('/:id', async (req, res, next) => {
  try {
  const userId = getUserId(res);
  const m = await prisma.bodyMeasurement.findUnique({ where: { id: req.params.id } });
  if (!m || m.userId !== userId) {
    return err(res, 404, '记录不存在', { affectsData: false });
  }
  await prisma.bodyMeasurement.delete({ where: { id: req.params.id } });

  // 档案体重跟着「剩下的最新一条」走。以前删掉最新那次称重后档案还留着那个数:
  // 体重页和历史里已经看不到它了,可下次改身高保存资料又会把它写回一条新测量,
  // 「删掉的值」原地复活。没有剩下任何体重测量时,只在档案正是这个值的情况下清空。
  if (m.weightKg != null) {
    const latest = await prisma.bodyMeasurement.findFirst({
      where: { userId, weightKg: { not: null } },
      orderBy: { measuredAt: 'desc' }
    });
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (profile) {
      const nextWeight = latest ? latest.weightKg : (profile.weightKg === m.weightKg ? null : profile.weightKg);
      if (nextWeight !== profile.weightKg) {
        await prisma.userProfile.update({ where: { userId }, data: { weightKg: nextWeight } });
      }
    }
    const day = toDateStr(m.measuredAt);
    await recomputeDaily(userId, day);
    if (day !== todayStr()) await recomputeDaily(userId, todayStr());
  }

  return ok(res, { deleted: true });
  } catch (error) { next(error); }
});

export default router;
