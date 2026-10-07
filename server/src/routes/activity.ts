import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { parsePage, pageResult } from '../lib/pagination';
import { toDate, todayStr, toDateStr } from '../lib/date';
import { recomputeDaily } from '../engine';

const router = Router();

export const CreateActivitySchema = z.object({
  type: z.string().trim().min(1),
  durationMin: z.number().int().positive().optional(),
  calories: z.number().finite().nonnegative().default(0),
  steps: z.number().int().nonnegative().optional(),
  startedAt: z.string().datetime(),
  source: z.string().default('manual'),
  provider: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional()
});

/** GET /activities?date=YYYY-MM-DD */
router.get('/', async (req, res) => {
  const dateStr = (req.query.date as string) || todayStr();
  const q = parsePage(req);
  const where = { userId: getUserId(res), date: toDate(dateStr), deletedAt: null };
  const [items, total] = await Promise.all([
    prisma.activityRecord.findMany({ where, orderBy: { startedAt: 'desc' }, skip: q.skip, take: q.take }),
    prisma.activityRecord.count({ where })
  ]);
  return ok(res, pageResult(items, total, q));
});

/** POST /activities */
router.post('/', async (req, res) => {
  const parsed = CreateActivitySchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');

  const startedAt = new Date(parsed.data.startedAt);
  const dateStr = toDateStr(startedAt);

  const activity = await prisma.activityRecord.create({
    data: {
      userId: getUserId(res),
      date: toDate(dateStr),
      type: parsed.data.type,
      durationMin: parsed.data.durationMin,
      calories: parsed.data.calories,
      steps: parsed.data.steps,
      startedAt,
      source: parsed.data.source,
      provider: parsed.data.provider ?? null,
      externalId: parsed.data.externalId ?? null,
      confidence: parsed.data.confidence ?? null
    }
  });

  const summary = await recomputeDaily(getUserId(res), dateStr);
  return ok(res, { activity, summary });
});

/** DELETE /activities/:id — 软删除 + 重算 */
router.delete('/:id', async (req, res) => {
  const activity = await prisma.activityRecord.findUnique({ where: { id: req.params.id } });
  if (!activity || activity.userId !== getUserId(res)) {
    return err(res, 404, '记录不存在', { affectsData: false });
  }
  const dateStr = toDateStr(activity.date);
  await prisma.activityRecord.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  const summary = await recomputeDaily(getUserId(res), dateStr);
  return ok(res, { deleted: true, recalculated: summary });
});

/** PUT /activities/:id — 编辑条目后重算 */
router.put('/:id', async (req, res) => {
  const existing = await prisma.activityRecord.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== getUserId(res)) {
    return err(res, 404, '记录不存在', { affectsData: false });
  }
  const parsed = CreateActivitySchema.partial().safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.startedAt) {
    const startedAt = new Date(parsed.data.startedAt);
    data.startedAt = startedAt;
    data.date = toDate(toDateStr(startedAt));
  }
  // 不允许改 provider/externalId(会破坏去重幂等)
  delete data.provider;
  delete data.externalId;

  const updated = await prisma.activityRecord.update({ where: { id: req.params.id }, data });
  const summary = await recomputeDaily(getUserId(res), toDateStr(updated.date));
  return ok(res, { activity: updated, summary });
});

export default router;
