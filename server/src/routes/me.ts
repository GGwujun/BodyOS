import { Router } from 'express';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';

const router = Router();

/** GET /me */
router.get('/', async (_req, res) => {
  let user = await prisma.user.findUnique({ where: { id: getUserId(res) } });
  if (!user) {
    user = await prisma.user.create({ data: { id: getUserId(res), nickname: '用户' } });
  }
  return ok(res, { id: user.id, nickname: user.nickname, avatar: user.avatar });
});

export default router;
