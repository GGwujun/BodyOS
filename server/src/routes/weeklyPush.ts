/**
 * 周报推送设置 —— GET/PUT 开关、POST /grant 领额度。
 * 结构照抄训练提醒(reminder.ts),只是砍掉了时间/语气/nudge:
 * 周报没有「几点发」可设,统一本地周一 08:00(见 lib/weeklyRunner.ts)。
 *
 * 额度规则同一条:微信一次授权只能发一条,所以 grant 是「加」不是「设」;
 * 未配模板时 GET 的 tmplId 是空串,客户端要如实说「推送暂不可用」,别让人白点授权。
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';

const router = Router();

/** 与 reminder.ts 同一个上限:额度是个位数,给上限只是防脏数据把库写花 */
export const MAX_GRANTS = 10;

export const WeeklyPushSchema = z.object({
  enabled: z.boolean(),
  /** 相对 UTC 的分钟数(东八区 480);范围是 UTC-14 ~ UTC+14 */
  tzOffsetMin: z.number().int().min(-840).max(840)
});

export const GrantSchema = z.object({
  /** 这一次授权拿到几条(微信一次授权 = 一条) */
  accepted: z.number().int().min(0).max(MAX_GRANTS)
});

export interface WeeklyPushDto {
  enabled: boolean;
  tzOffsetMin: number;
  /** 服务端还能发几条 */
  grants: number;
  /** 最后一次发送对应那个周一的本地日期 */
  lastSentOn: string | null;
  /** 订阅消息模板 id;空串 = 后台还没配,推送链路是死的 */
  tmplId: string;
}

export function toDto(
  row: { enabled: boolean; tzOffsetMin: number; grants: number; lastSentOn: string | null } | null
): WeeklyPushDto {
  return {
    enabled: row?.enabled ?? false,
    tzOffsetMin: row?.tzOffsetMin ?? 480,
    grants: row?.grants ?? 0,
    lastSentOn: row?.lastSentOn ?? null,
    tmplId: env.wechatTmplWeekly
  };
}

/** GET /weekly-push —— 没设置过就回默认(不建行) */
router.get('/', wrap(async (_req, res) => {
  const row = await prisma.weeklyPushSetting.findUnique({ where: { userId: getUserId(res) } });
  return ok(res, toDto(row));
}));

/** PUT /weekly-push —— 开关 + 时区。开着开关但没额度,客户端会引导再领一次 */
router.put('/', wrap(async (req, res) => {
  const parsed = WeeklyPushSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, parsed.error.issues[0]?.message || '参数错误', { affectsData: false });

  const userId = getUserId(res);
  const row = await prisma.weeklyPushSetting.upsert({
    where: { userId },
    update: parsed.data,
    create: { userId, ...parsed.data }
  });
  return ok(res, toDto(row));
}));

/** POST /weekly-push/grant —— 用户刚点过授权,把额度加上 */
router.post('/grant', wrap(async (req, res) => {
  const parsed = GrantSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误', { affectsData: false });

  const userId = getUserId(res);
  const prev = await prisma.weeklyPushSetting.findUnique({ where: { userId } });
  const grants = Math.min(MAX_GRANTS, (prev?.grants ?? 0) + parsed.data.accepted);

  const row = await prisma.weeklyPushSetting.upsert({
    where: { userId },
    update: { grants },
    create: { userId, grants }
  });
  return ok(res, toDto(row));
}));

export default router;
