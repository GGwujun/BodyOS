import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';
import { env } from '../env';
import { logInfo } from '../lib/log';
import { todayStr } from '../lib/date';
import { DEFAULT_QUOTES, pickQuoteIndex, validateQuoteList } from '../lib/dailyQuotes';

/**
 * 每日分享卡 · 金句接口。
 *
 * GET /  → 当天的金句(确定性轮换,全站同一条)。表空时自动种默认库 ——
 *          部署后不用手工灌数据,第一次请求就把 30 条落进去。
 * 管理端(x-admin-key,挂在鉴权前):GET /admin 列表、PUT / 整体替换。
 * 「整体替换」而不是逐条增删:金句库小、改的频率低,一次换一版最不容易错位;
 * 历史版本不保留(库本身就是文案,不是用户数据)。
 */

const router = Router();

/** 表空时种入默认库;并发首刷靠 createMany 幂等不了,但 worst case 是多插一份,下一次替换就归位 */
async function ensureSeeded(): Promise<void> {
  const n = await prisma.dailyQuote.count();
  if (n > 0) return;
  await prisma.dailyQuote.createMany({
    data: DEFAULT_QUOTES.map((q, i) => ({ ...q, sort: i }))
  });
  logInfo('daily-quote', '种入默认金句库', { count: DEFAULT_QUOTES.length });
}

router.get('/', wrap(async (req, res) => {
  const date = (req.query.date as string) || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  await ensureSeeded();
  const rows = await prisma.dailyQuote.findMany({
    where: { active: true },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }]
  });
  if (rows.length === 0) return ok(res, { date, quote: DEFAULT_QUOTES[pickQuoteIndex(date, DEFAULT_QUOTES.length)], total: 0 });
  const row = rows[pickQuoteIndex(date, rows.length)];
  // 顺带返回「 TA 已坚持记录 N 天」:注册日到今天,注册在 N 天前就是第 N+1 天
  const userId = getUserId(res);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  const days = user
    ? Math.max(1, Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000) + 1)
    : 1;
  return ok(res, { date, quote: { text: row.text, sub: row.sub, category: row.category }, total: rows.length, recordDays: days });
}));

export default router;

/** 管理端:挂在 attachUser 之前,只认 x-admin-key(和 feedback 管理端同一把锁) */
export const dailyQuoteAdminRouter = Router();

function adminAllowed(req: Request, res: Response): boolean {
  if (env.adminApiKey) {
    if (req.headers['x-admin-key'] !== env.adminApiKey) {
      err(res, 403, '无权访问');
      return false;
    }
    return true;
  }
  if (env.nodeEnv === 'production') {
    err(res, 404, '接口不存在');
    return false;
  }
  return true;
}

dailyQuoteAdminRouter.get('/admin', wrap(async (req, res) => {
  if (!adminAllowed(req, res)) return;
  const rows = await prisma.dailyQuote.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
  return ok(res, rows);
}));

const PutSchema = z.object({
  quotes: z.array(z.object({
    text: z.string(),
    sub: z.string(),
    category: z.string().optional()
  })).min(1)
});

/** PUT /  整体替换金句库 */
dailyQuoteAdminRouter.put('/', wrap(async (req, res) => {
  if (!adminAllowed(req, res)) return;
  const parsed = PutSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数应为 { quotes: [{text,sub,category?}] }', { affectsData: false });
  const { quotes, error } = validateQuoteList(parsed.data.quotes);
  if (error) return err(res, 400, error, { affectsData: false });
  await prisma.$transaction([
    prisma.dailyQuote.deleteMany({}),
    prisma.dailyQuote.createMany({ data: quotes.map((q, i) => ({ ...q, sort: i })) })
  ]);
  logInfo('daily-quote', '金句库整体替换', { count: quotes.length });
  return ok(res, { count: quotes.length });
}));
