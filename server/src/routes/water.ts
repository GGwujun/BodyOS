import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { toDate, todayStr, isValidDateStr } from '../lib/date';
import { wrap } from '../lib/asyncHandler';
import { recomputeDaily } from '../engine';

const router = Router();

const DEFAULT_GOAL_ML = 1500;
const MAX_DAILY_ML = 10_000;

async function waterStatus(userId: string, dateStr: string) {
  const date = toDate(dateStr);
  const [log, profile] = await Promise.all([
    prisma.waterLog.findUnique({ where: { userId_date: { userId, date } } }),
    prisma.userProfile.findUnique({ where: { userId }, select: { waterGoalMl: true } })
  ]);
  return { date: dateStr, amountMl: log?.amountMl ?? 0, goalMl: profile?.waterGoalMl ?? DEFAULT_GOAL_ML };
}

/** GET /water?date=YYYY-MM-DD — 当日水量与目标 */
router.get('/', wrap(async (req, res) => {
  const dateStr = (req.query.date as string) || todayStr();
  if (!isValidDateStr(dateStr)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  return ok(res, await waterStatus(getUserId(res), dateStr));
}));

/** POST /water — 打卡累加 { date?, amountMl } */
const AddSchema = z.object({
  date: z.string().optional(),
  amountMl: z.number().int().finite().min(1).max(2000)
});

router.post('/', wrap(async (req, res) => {
  const parsed = AddSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, 'amountMl 应为 1-2000 的整数(毫升)');
  const dateStr = parsed.data.date || todayStr();
  if (!isValidDateStr(dateStr)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  const userId = getUserId(res);
  const date = toDate(dateStr);

  // 读-改-写放在事务里,并发打卡不丢累加;单日上限封顶
  const log = await prisma.$transaction(async (tx) => {
    const existing = await tx.waterLog.findUnique({ where: { userId_date: { userId, date } } });
    const next = Math.min(MAX_DAILY_ML, (existing?.amountMl ?? 0) + parsed.data.amountMl);
    return tx.waterLog.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, amountMl: next },
      update: { amountMl: next }
    });
  });
  const { goalMl } = await waterStatus(userId, dateStr);
  void recomputeDaily(userId, dateStr); // 异步刷新当日汇总,不阻塞打卡返回
  return ok(res, { date: dateStr, amountMl: log.amountMl, goalMl });
}));

/** PUT /water — 直接设置当日总量(改错/补录) { date?, amountMl } */
const SetSchema = z.object({
  date: z.string().optional(),
  amountMl: z.number().int().finite().min(0).max(MAX_DAILY_ML)
});

router.put('/', wrap(async (req, res) => {
  const parsed = SetSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, `amountMl 应为 0-${MAX_DAILY_ML} 的整数(毫升)`);
  const dateStr = parsed.data.date || todayStr();
  if (!isValidDateStr(dateStr)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  const userId = getUserId(res);
  const date = toDate(dateStr);

  const log = await prisma.waterLog.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, amountMl: parsed.data.amountMl },
    update: { amountMl: parsed.data.amountMl }
  });
  const { goalMl } = await waterStatus(userId, dateStr);
  void recomputeDaily(userId, dateStr); // 异步刷新当日汇总,不阻塞返回
  return ok(res, { date: dateStr, amountMl: log.amountMl, goalMl });
}));

export default router;
