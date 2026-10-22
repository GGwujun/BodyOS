import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';

const router = Router();

/** 和 FoodLog 里的 FoodItem 同一套校验口径 —— 存进「我的」的条目以后还要原样加回餐里 */
const CustomFoodSchema = z.object({
  name: z.string().trim().min(1).max(50),
  amount: z.string().trim().max(30).default(''),
  calories: z.number().finite().nonnegative().max(20_000),
  proteinG: z.number().finite().nonnegative().max(2_000).default(0),
  carbG: z.number().finite().nonnegative().max(2_000).default(0),
  fatG: z.number().finite().nonnegative().max(2_000).default(0)
});

/** GET /custom-foods — 我的食物(存的顺序,新的在前)。条目是用户自己攒的,给个宽松上限 */
router.get('/', wrap(async (req, res) => {
  const items = await prisma.customFood.findMany({
    where: { userId: getUserId(res) },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return ok(res, { items });
}));

/** POST /custom-foods — 存一条;同名同份量已存在就覆盖数字(以最新核对为准) */
router.post('/', wrap(async (req, res) => {
  const parsed = CustomFoodSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');
  const { name, amount, calories, proteinG, carbG, fatG } = parsed.data;
  const food = await prisma.customFood.upsert({
    where: { userId_name_amount: { userId: getUserId(res), name, amount } },
    create: { userId: getUserId(res), name, amount, calories, proteinG, carbG, fatG },
    update: { calories, proteinG, carbG, fatG }
  });
  return ok(res, { food });
}));

/** DELETE /custom-foods/:id */
router.delete('/:id', wrap(async (req, res) => {
  const food = await prisma.customFood.findUnique({ where: { id: req.params.id } });
  if (!food || food.userId !== getUserId(res)) {
    return err(res, 404, '条目不存在', { affectsData: false });
  }
  await prisma.customFood.delete({ where: { id: req.params.id } });
  return ok(res, { deleted: true });
}));

export default router;
