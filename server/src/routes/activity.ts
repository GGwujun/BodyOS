import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { parsePage, pageResult } from '../lib/pagination';
import { toDate, todayStr, toDateStr, isValidDateStr } from '../lib/date';
import { wrap } from '../lib/asyncHandler';
import { recomputeDaily } from '../engine';

const router = Router();

export const CreateActivitySchema = z.object({
  type: z.string().trim().min(1).max(30),
  durationMin: z.number().int().positive().max(24 * 60).optional(),
  calories: z.number().finite().nonnegative().max(20_000).default(0),
  /**
   * 距离(米)。500 公里封顶 —— 挡住「把体重填进距离栏」那类手滑,配上界才不会存进荒唐数据。
   * 用 nullish 而不是 optional:编辑时用户把距离删掉要能真的**清空**(null),
   * 只认 optional 的话「清空」和「不改」在请求里长得一模一样,距离就永远删不掉了。
   */
  distanceM: z.number().int().positive().max(500_000).nullish(),
  /** 跑步机坡度(%)。口径同 openGym 的 incline:0-40,半格一档 */
  inclinePct: z.number().finite().nonnegative().max(40).nullish(),
  steps: z.number().int().nonnegative().optional(),
  startedAt: z.string().datetime(),
  source: z.string().default('manual'),
  provider: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional()
});

/** GET /activities?date=YYYY-MM-DD */
router.get('/', wrap(async (req, res) => {
  const dateStr = (req.query.date as string) || todayStr();
  if (!isValidDateStr(dateStr)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  const q = parsePage(req);
  const where = { userId: getUserId(res), date: toDate(dateStr), deletedAt: null };
  const [items, total] = await Promise.all([
    prisma.activityRecord.findMany({ where, orderBy: { startedAt: 'desc' }, skip: q.skip, take: q.take }),
    prisma.activityRecord.count({ where })
  ]);
  return ok(res, pageResult(items, total, q));
}));

/**
 * 一条活动记录的可写字段。
 *
 * `provider` 在带 externalId 时**必须有值**:PG 的唯一约束把 NULL 当作互不相等,
 * `@@unique([userId, provider, externalId])` 在 provider=NULL 时等于没加。
 * 训练回写以前正是这样 —— 同一个 externalId 连发两次会落两条,热量算两遍。
 * 没有单独给 provider 的调用方(训练模块)用 source 兜底,约束才真的生效。
 */
function activityFields(data: z.infer<typeof CreateActivitySchema>, startedAt: Date, dateStr: string) {
  const externalId = data.externalId ?? null;
  return {
    date: toDate(dateStr),
    type: data.type,
    durationMin: data.durationMin,
    calories: data.calories,
    distanceM: data.distanceM ?? null,
    inclinePct: data.inclinePct ?? null,
    steps: data.steps,
    startedAt,
    source: data.source,
    provider: data.provider ?? (externalId ? data.source : null),
    externalId,
    confidence: data.confidence ?? null
  };
}

/** POST /activities —— 带 externalId 时按「同一个外部事件」幂等写入 */
router.post('/', wrap(async (req, res) => {
  const parsed = CreateActivitySchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');

  const userId = getUserId(res);
  const startedAt = new Date(parsed.data.startedAt);
  const dateStr = toDateStr(startedAt);
  const fields = activityFields(parsed.data, startedAt, dateStr);
  const { externalId } = fields;

  if (externalId) {
    // 老版本写下的记录 provider 还是 NULL,一并认出来并补上 —— 不然升级后第一次重试
    // 会找不到它、再建一条,旧数据也会继续绕开唯一约束。
    const existing = await prisma.activityRecord.findFirst({
      where: {
        userId,
        externalId,
        OR: [{ provider: fields.provider! }, { provider: null }]
      },
      orderBy: { createdAt: 'asc' }
    });
    if (existing) {
      const oldDate = toDateStr(existing.date);
      const activity = await prisma.activityRecord.update({
        where: { id: existing.id },
        data: { ...fields, deletedAt: null }
      });
      // 重试可能带着新的 startedAt(比如跨午夜那场):两天都要重算
      const summary = await recomputeDaily(userId, dateStr);
      if (oldDate !== dateStr) await recomputeDaily(userId, oldDate);
      return ok(res, { activity, summary, deduplicated: true });
    }
  }

  try {
    const activity = await prisma.activityRecord.create({ data: { userId, ...fields } });
    const summary = await recomputeDaily(userId, dateStr);
    return ok(res, { activity, summary });
  } catch (error) {
    // 并发的两次 POST 都查不到、又同时 create:唯一约束只会让一条成功。
    // 另一条不是服务器错误,而是「已经被写过了」—— 找到那一条并更新,返回 200。
    if ((error as { code?: string }).code !== 'P2002' || !externalId) throw error;
    const existing = await prisma.activityRecord.findFirst({
      where: { userId, externalId, provider: fields.provider! }
    });
    if (!existing) throw error;
    const activity = await prisma.activityRecord.update({
      where: { id: existing.id },
      data: { ...fields, deletedAt: null }
    });
    const summary = await recomputeDaily(userId, dateStr);
    return ok(res, { activity, summary, deduplicated: true });
  }
}));

/** DELETE /activities/:id — 软删除 + 重算 */
router.delete('/:id', wrap(async (req, res) => {
  const activity = await prisma.activityRecord.findUnique({ where: { id: req.params.id } });
  if (!activity || activity.userId !== getUserId(res)) {
    return err(res, 404, '记录不存在', { affectsData: false });
  }
  const dateStr = toDateStr(activity.date);
  await prisma.activityRecord.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  const summary = await recomputeDaily(getUserId(res), dateStr);
  return ok(res, { deleted: true, recalculated: summary });
}));

/** PUT /activities/:id — 编辑条目后重算 */
router.put('/:id', wrap(async (req, res) => {
  const existing = await prisma.activityRecord.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== getUserId(res)) {
    return err(res, 404, '记录不存在', { affectsData: false });
  }
  const parsed = CreateActivitySchema.partial().safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');

  const oldDate = toDateStr(existing.date);
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
  const newDate = toDateStr(updated.date);
  const summary = await recomputeDaily(getUserId(res), newDate);
  // 改到另一天时,旧那天的消耗必须一起减掉 —— 只算新日期会留下一条
  // 「记录已经不在了、热量还挂在账上」的幽灵
  if (newDate !== oldDate) await recomputeDaily(getUserId(res), oldDate);
  return ok(res, { activity: updated, summary });
}));

export default router;
