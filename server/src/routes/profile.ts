import { Router } from 'express';
import { ProfileSchema } from '../lib/profileValidation';
import { prisma } from '../db';
import { USER_ID } from '../lib/currentUser';
import { ok, err } from '../lib/http';

const router = Router();

async function ensureProfile() {
  return (
    (await prisma.userProfile.findUnique({ where: { userId: USER_ID } })) ??
    (await prisma.userProfile.create({ data: { userId: USER_ID, gender:'other' } }))
  );
}

/** GET /profile */
router.get('/', async (_req, res) => {
  const profile = await ensureProfile();
  return ok(res, profile);
});

/** PUT /profile */
router.put('/', async (req, res) => {
  const parsed = ProfileSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, parsed.error.issues[0]?.message || '参数错误');
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.birthDate) data.birthDate = new Date(parsed.data.birthDate);

  const profile = await prisma.userProfile.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, gender:'other', ...data } as never,
    update: data as never
  });
  return ok(res, profile);
});

export default router;
