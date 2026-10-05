import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { USER_ID } from '../lib/currentUser';
import { ok, err } from '../lib/http';

const router = Router();

const CreateGoalSchema = z.object({
  type: z.enum(['fat_loss', 'muscle_gain', 'maintain', 'endurance']),
  targetValue: z.number().positive(),
  unit: z.string(),
  durationWeeks: z.number().int().positive().optional(),
  startDate: z.string().datetime().optional(),
  isActive: z.boolean().optional()
});

/** GET /goals */
router.get('/', async (_req, res) => {
  const goals = await prisma.goal.findMany({
    where: { userId: USER_ID, isActive: true },
    orderBy: { createdAt: 'desc' }
  });
  return ok(res, goals);
});

/** POST /goals */
router.post('/', async (req, res) => {
  const parsed = CreateGoalSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');
  const { startDate, ...rest } = parsed.data;
  const goal = await prisma.$transaction(async tx => {
    if (rest.isActive !== false) {
      await tx.goal.updateMany({where:{userId:USER_ID,isActive:true},data:{isActive:false}});
    }
    return tx.goal.create({
    data: {
      userId: USER_ID,
      startDate: startDate ? new Date(startDate) : new Date(),
      ...rest
    }
    });
  });
  return ok(res, goal);
});

/** PUT /goals/:id */
router.put('/:id', async (req, res) => {
  const existing = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== USER_ID) {
    return err(res, 404, '目标不存在', { affectsData: false });
  }
  const parsed = CreateGoalSchema.partial().safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');
  const { startDate, ...rest } = parsed.data;
  const goal = await prisma.$transaction(async tx => {
    if (rest.isActive === true) {
      await tx.goal.updateMany({where:{userId:USER_ID,isActive:true,id:{not:existing.id}},data:{isActive:false}});
    }
    return tx.goal.update({
    where: { id: req.params.id },
    data: { ...rest, ...(startDate ? { startDate: new Date(startDate) } : {}) }
    });
  });
  return ok(res, goal);
});

/** DELETE /goals/:id — 归档(置 isActive=false) */
router.delete('/:id', async (req, res) => {
  const existing = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== USER_ID) {
    return err(res, 404, '目标不存在', { affectsData: false });
  }
  await prisma.goal.update({ where: { id: req.params.id }, data: { isActive: false } });
  return ok(res, { archived: true });
});

export default router;
