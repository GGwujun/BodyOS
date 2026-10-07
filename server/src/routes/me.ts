import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';

const router = Router();

/** GET /me */
router.get('/', wrap(async (_req, res) => {
  const user = await ensureUser(getUserId(res));
  return ok(res, { id: user.id, nickname: user.nickname, avatar: user.avatar });
}));

/** PUT /me — 保存昵称(微信已不支持小程序自动获取昵称,由"头像昵称填写能力"主动填写) */
const UpdateMeSchema = z.object({
  nickname: z.string().trim().min(1, '昵称不能为空').max(30, '昵称最多 30 个字')
});

router.put('/', wrap(async (req, res) => {
  const parsed = UpdateMeSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, parsed.error.issues[0]?.message ?? '参数错误');
  const user = await ensureUser(getUserId(res));
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { nickname: parsed.data.nickname }
  });
  return ok(res, { id: updated.id, nickname: updated.nickname, avatar: updated.avatar });
}));

async function ensureUser(userId: string) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) return existing;
  return prisma.user.create({ data: { id: userId, nickname: '用户' } });
}

export default router;
