import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { USER_ID } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { parsePage, pageResult } from '../lib/pagination';
import { toDate, todayStr, toDateStr } from '../lib/date';
import { recomputeDaily } from '../engine';

const router = Router();

const FoodItemSchema = z.object({
  name: z.string(),
  amount: z.string().default(''),
  calories: z.number().default(0),
  proteinG: z.number().default(0),
  carbG: z.number().default(0),
  fatG: z.number().default(0),
  fiberG: z.number().default(0)
});

const CreateFoodLogSchema = z.object({
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  items: z.array(FoodItemSchema).min(1),
  source: z.enum(['manual', 'ai_text', 'ai_image']).default('manual'),
  loggedAt: z.string().datetime().optional()
});

/** GET /food-logs?date=YYYY-MM-DD */
router.get('/', async (req, res) => {
  const dateStr = (req.query.date as string) || todayStr();
  const q = parsePage(req);
  const where = { userId: USER_ID, date: toDate(dateStr), deletedAt: null };
  const [items, total] = await Promise.all([
    prisma.foodLog.findMany({ where, orderBy: { loggedAt: 'desc' }, skip: q.skip, take: q.take }),
    prisma.foodLog.count({ where })
  ]);
  return ok(res, pageResult(items, total, q));
});

/** POST /food-logs */
router.post('/', async (req, res) => {
  const parsed = CreateFoodLogSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');

  const items = parsed.data.items;
  const totalCalories = items.reduce((s, i) => s + i.calories, 0);
  const proteinG = items.reduce((s, i) => s + i.proteinG, 0);
  const carbG = items.reduce((s, i) => s + i.carbG, 0);
  const fatG = items.reduce((s, i) => s + i.fatG, 0);
  const fiberG = items.reduce((s, i) => s + i.fiberG, 0);

  const loggedAt = parsed.data.loggedAt ? new Date(parsed.data.loggedAt) : new Date();
  const dateStr = toDateStr(loggedAt);

  const foodLog = await prisma.foodLog.create({
    data: {
      userId: USER_ID,
      date: toDate(dateStr),
      meal: parsed.data.meal,
      items,
      totalCalories,
      proteinG,
      carbG,
      fatG,
      fiberG,
      source: parsed.data.source,
      loggedAt
    }
  });

  // 增删后重算当日汇总
  const summary = await recomputeDaily(USER_ID, dateStr);
  return ok(res, { foodLog, summary });
});

/** DELETE /food-logs/:id — 软删除 + 重算(docs/02 二次确认在前端,此处返回影响) */
router.delete('/:id', async (req, res) => {
  const foodLog = await prisma.foodLog.findUnique({ where: { id: req.params.id } });
  if (!foodLog || foodLog.userId !== USER_ID) {
    return err(res, 404, '记录不存在', { affectsData: false });
  }
  const dateStr = toDateStr(foodLog.date);
  await prisma.foodLog.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  const summary = await recomputeDaily(USER_ID, dateStr);
  return ok(res, { deleted: true, recalculated: summary });
});

/** PUT /food-logs/:id — 编辑条目(改 meal/items)后重算 */
router.put('/:id', async (req, res) => {
  const existing = await prisma.foodLog.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== USER_ID) {
    return err(res, 404, '记录不存在', { affectsData: false });
  }
  const parsed = CreateFoodLogSchema.partial().safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');

  const items = parsed.data.items ?? (existing.items as unknown as z.infer<typeof FoodItemSchema>[]);
  const totalCalories = items.reduce((s, i) => s + i.calories, 0);
  const proteinG = items.reduce((s, i) => s + i.proteinG, 0);
  const carbG = items.reduce((s, i) => s + i.carbG, 0);
  const fatG = items.reduce((s, i) => s + i.fatG, 0);
  const fiberG = items.reduce((s, i) => s + i.fiberG, 0);

  const updated = await prisma.foodLog.update({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.meal ? { meal: parsed.data.meal } : {}),
      items,
      totalCalories,
      proteinG,
      carbG,
      fatG,
      fiberG
    }
  });
  const summary = await recomputeDaily(USER_ID, toDateStr(updated.date));
  return ok(res, { foodLog: updated, summary });
});

export default router;
