/**
 * 训练提醒 —— 设置在服务端存一份,定时发送也靠它。
 *
 * 为什么不能只存在手机上:小程序的订阅消息**只能由服务端发**(客户端离开小程序后
 * 没有任何执行机会,小程序也没有本地通知)。要按时发,服务端就得知道:几点发、
 * 按哪个时区算、还剩几次可发 —— 这些跟账号走,换手机不用重设。
 *
 * 三条规则值得写下来:
 *  1. **一天最多一条**。lastSentOn 存的是「用户本地日期」,不是服务端日期 ——
 *     否则东八区用户晚上 8 点的提醒会被算到 UTC 的前一天。
 *  2. **到点时间已经过了就不再补**。用户晚上 10 点才打开开关设了个 20:00 的提醒,
 *     不该当场收到一条(那会白烧掉一次只有一次的授权额度),从明天开始。
 *  3. **没配模板就老实说**。GET 会带上模板 id(客户端申请授权要用它),空串就是
 *     还没配 —— 客户端据此说明「现在只有小程序内的提醒」,而不是让用户点了授权却永远收不到。
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';
import { hhmmToMin, localClock, localDay } from '../lib/reminderSchedule';

const router = Router();

export const TONES = ['gentle', 'fun', 'cheer'] as const;
/** 与 lib/reminderSchedule.ts 的 HHMM_RE 保持一致(两处都要捕获组,免得又踩 m[2] 是 undefined 的坑) */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** 一次授权只能发一条,所以额度是个位数;给上限只是防脏数据把库写花 */
export const MAX_GRANTS = 10;

export const ReminderSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(TIME_RE, '提醒时间要写成 HH:mm'),
  tone: z.enum(TONES),
  nudge: z.boolean(),
  /** 相对 UTC 的分钟数(东八区 480);范围是 UTC-14 ~ UTC+14 */
  tzOffsetMin: z.number().int().min(-840).max(840)
});

export const GrantSchema = z.object({
  /** 这一次授权拿到几条(微信一次授权 = 一条,但客户端可能一次问多个模板) */
  accepted: z.number().int().min(0).max(MAX_GRANTS)
});

export interface ReminderDto {
  enabled: boolean;
  time: string;
  tone: string;
  nudge: boolean;
  tzOffsetMin: number;
  /** 服务端还能发几条 */
  grants: number;
  /** 最后一次发出的用户本地日期 */
  lastSentOn: string | null;
  /**
   * 订阅消息模板 id —— 客户端必须拿到它才能调 requestSubscribeMessage 申请授权,
   * 所以这里要下发(它不是密钥,小程序端本来就要用)。空串 = 后台还没配,
   * 这时整条推送链路是死的,客户端要如实告诉用户,而不是让人白点一下授权。
   */
  tmplId: string;
}

export function toDto(
  row: { enabled: boolean; time: string; tone: string; nudge: boolean; tzOffsetMin: number; grants: number; lastSentOn: string | null } | null
): ReminderDto {
  return {
    enabled: row?.enabled ?? false,
    time: row?.time ?? '20:00',
    tone: row?.tone ?? 'gentle',
    nudge: row?.nudge ?? true,
    tzOffsetMin: row?.tzOffsetMin ?? 480,
    grants: row?.grants ?? 0,
    lastSentOn: row?.lastSentOn ?? null,
    tmplId: env.wechatTmplTraining
  };
}

/**
 * 保存设置之后 lastSentOn 该是什么(纯函数)。
 * 除了「今天已经发过就别再发第二条」,还要处理「刚打开开关、可到点时间已经过了」——
 * 那种情况把今天记为已发,免得当场烧掉一次授权,从明天正常开始。
 */
export function nextLastSentOn(
  prev: string | null,
  input: { enabled: boolean; time: string; tzOffsetMin: number },
  nowMs: number
): string | null {
  if (!input.enabled) return prev;
  const target = hhmmToMin(input.time);
  if (target == null) return prev;
  const tz = Number.isFinite(input.tzOffsetMin) ? input.tzOffsetMin : 480;
  const day = localDay(nowMs, tz);
  if (prev === day) return prev; // 一天一条,改时间也不当天补
  const clock = localClock(nowMs, tz);
  const nowMin = clock.getUTCHours() * 60 + clock.getUTCMinutes();
  return nowMin > target ? day : prev;
}

/** GET /training/reminder —— 没设置过就回默认(不建行,省得每个用户一行空数据) */
router.get('/', wrap(async (_req, res) => {
  const row = await prisma.trainingReminder.findUnique({ where: { userId: getUserId(res) } });
  return ok(res, toDto(row));
}));

/** PUT /training/reminder —— 整份覆盖(表单就是这么用的) */
router.put('/', wrap(async (req, res) => {
  const parsed = ReminderSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, parsed.error.issues[0]?.message || '参数错误', { affectsData: false });

  const userId = getUserId(res);
  const prev = await prisma.trainingReminder.findUnique({ where: { userId } });
  const d = parsed.data;
  const lastSentOn = nextLastSentOn(prev?.lastSentOn ?? null, d, Date.now());
  const data = { ...d, lastSentOn };

  const row = await prisma.trainingReminder.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data }
  });
  return ok(res, toDto(row));
}));

/**
 * POST /training/reminder/grant —— 用户刚点过授权,把额度加上。
 * 微信的规矩是一次授权只能发一条,所以这里是「加」不是「设」。
 */
router.post('/grant', wrap(async (req, res) => {
  const parsed = GrantSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误', { affectsData: false });

  const userId = getUserId(res);
  const prev = await prisma.trainingReminder.findUnique({ where: { userId } });
  const grants = Math.min(MAX_GRANTS, (prev?.grants ?? 0) + parsed.data.accepted);

  const row = await prisma.trainingReminder.upsert({
    where: { userId },
    update: { grants },
    create: { userId, grants }
  });
  return ok(res, toDto(row));
}));

export default router;
