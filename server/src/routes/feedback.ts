import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';
import { env } from '../env';
import { logInfo } from '../lib/log';

/**
 * 意见反馈 —— 用户主动写的「哪里不对 / 希望加什么」。
 *
 * 收集口径刻意很窄:正文、选填联系方式、最多三张截图,加上页面/版本/机型这类
 * **排障上下文**。身体数据、openid、令牌一律不进来 —— 反馈页上那句
 * 「不包含任何健康数据」不是文案装饰,是这一层 zod 白名单在兜底。
 *
 * 管理端是「ADMIN_API_KEY + x-admin-key」那把锁(和 /analytics/metrics 同一套):
 * 生产没配 key 就当接口不存在,配了也必须带对头。它挂在鉴权中间件**之前**,
 * 因为运营查反馈不该先拿一个小程序用户令牌;用户侧的 POST 仍然挂在鉴权之后。
 */

/** 用户侧:POST /feedback */
const router = Router();

const FeedbackSchema = z.object({
  kind: z.enum(['bug', 'idea']),
  content: z.string().trim().min(4, '再多写一句吧，至少 4 个字').max(1000, '最多 1000 字'),
  contact: z.string().trim().max(80, '联系方式太长了').optional().nullable(),
  // 只认本站上传接口落下来的地址,不让客户端借反馈塞外链
  images: z.array(z.string().regex(/^\/media\/[A-Za-z0-9._-]+$/)).max(3, '最多 3 张截图').optional(),
  pagePath: z.string().trim().max(160).optional().nullable(),
  appVersion: z.string().trim().max(32).optional().nullable(),
  sdkVersion: z.string().trim().max(32).optional().nullable(),
  platform: z.string().trim().max(80).optional().nullable()
});

const WINDOW_30S = 30 * 1000;
const WINDOW_24H = 24 * 60 * 60 * 1000;
const PER_DAY = 10;

router.post('/', wrap(async (req, res) => {
  const parsed = FeedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return err(res, 400, parsed.error.issues[0]?.message || '参数错误', { affectsData: false });
  }
  const userId = getUserId(res);
  const now = Date.now();
  // 不引额外的限流依赖:反馈量本来就小,一条带索引的 count 就够
  const [recent, today] = await Promise.all([
    prisma.feedback.count({ where: { userId, createdAt: { gte: new Date(now - WINDOW_30S) } } }),
    prisma.feedback.count({ where: { userId, createdAt: { gte: new Date(now - WINDOW_24H) } } })
  ]);
  if (recent > 0) return err(res, 429, '发得太快了，过一会儿再试', { affectsData: false });
  if (today >= PER_DAY) return err(res, 429, '今天已经提交很多条了，明天再来吧', { affectsData: false });

  const d = parsed.data;
  const row = await prisma.feedback.create({
    data: {
      userId,
      kind: d.kind,
      content: d.content,
      contact: d.contact || null,
      images: (d.images?.length ? d.images : null) as never,
      pagePath: d.pagePath || null,
      appVersion: d.appVersion || null,
      sdkVersion: d.sdkVersion || null,
      platform: d.platform || null
    }
  });
  // 只记长度和形态,不记正文:反馈里可能夹带用户自己的隐私
  logInfo('feedback', '收到反馈', {
    id: row.id, userId, kind: row.kind, chars: d.content.length, hasImages: Boolean(d.images?.length)
  });
  return ok(res, { id: row.id });
}));

export default router;

/** 管理端:挂在 attachUser 之前,只认 x-admin-key */
export const feedbackAdminRouter = Router();

function adminAllowed(req: Request, res: Response): boolean {
  if (env.adminApiKey) {
    if (req.headers['x-admin-key'] !== env.adminApiKey) {
      err(res, 403, '无权访问');
      return false;
    }
    return true;
  }
  // 生产没配密钥时当接口不存在;本地开发放行,便于 curl 核对
  if (env.nodeEnv === 'production') {
    err(res, 404, '接口不存在');
    return false;
  }
  return true;
}

const StatusQuery = z.enum(['open', 'replied', 'closed', 'all']).default('open');

/** GET /feedback?status=open&limit=50 */
feedbackAdminRouter.get('/', wrap(async (req, res) => {
  if (!adminAllowed(req, res)) return;
  const q = StatusQuery.safeParse(req.query.status);
  const status = q.success ? q.data : 'open';
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50;
  const items = await prisma.feedback.findMany({
    where: status === 'all' ? {} : { status },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
  return ok(res, items);
}));

const PatchSchema = z.object({
  status: z.enum(['open', 'replied', 'closed']).optional(),
  adminNote: z.string().trim().max(1000).optional().nullable()
});

/** PATCH /feedback/:id — 改状态 / 记一句处理备注 */
feedbackAdminRouter.patch('/:id', wrap(async (req, res) => {
  if (!adminAllowed(req, res)) return;
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误', { affectsData: false });
  if (!parsed.data.status && !('adminNote' in parsed.data)) return err(res, 400, '没有要改的内容');
  try {
    const row = await prisma.feedback.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...('adminNote' in parsed.data ? { adminNote: parsed.data.adminNote || null } : {})
      }
    });
    return ok(res, row);
  } catch {
    return err(res, 404, '反馈不存在');
  }
}));
