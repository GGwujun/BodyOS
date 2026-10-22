import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { toDate, todayStr, isValidDateStr } from '../lib/date';
import { wrap } from '../lib/asyncHandler';
import { recomputeDaily } from '../engine';

const router = Router();

const MAX_MINUTES = 24 * 60;

/** GET /sleep?date=YYYY-MM-DD — 那一晚的睡眠时长(没记过为 0) */
router.get('/', wrap(async (req, res) => {
  const dateStr = (req.query.date as string) || todayStr();
  if (!isValidDateStr(dateStr)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  const log = await prisma.sleepLog.findUnique({
    where: { userId_date: { userId: getUserId(res), date: toDate(dateStr) } }
  });
  return ok(res, { date: dateStr, minutes: log?.minutes ?? 0 });
}));

/** PUT /sleep — 记/改昨晚时长 { date?, minutes }。一天一条,重记覆盖 */
const SetSchema = z.object({
  date: z.string().optional(),
  minutes: z.number().int().finite().min(0).max(MAX_MINUTES)
});

router.put('/', wrap(async (req, res) => {
  const parsed = SetSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, `minutes 应为 0-${MAX_MINUTES} 的整数(分钟)`);
  const dateStr = parsed.data.date || todayStr();
  if (!isValidDateStr(dateStr)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  const userId = getUserId(res);
  const date = toDate(dateStr);

  const log = await prisma.sleepLog.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, minutes: parsed.data.minutes },
    update: { minutes: parsed.data.minutes }
  });
  void recomputeDaily(userId, dateStr); // 汇总跟着动,但不让记一笔的人等重算
  return ok(res, { date: dateStr, minutes: log.minutes });
}));

export default router;
