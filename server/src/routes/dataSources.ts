import { Router } from 'express';
import { prisma } from '../db';
import { USER_ID } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { getAdapter, isSupported, providerName, KNOWN_PROVIDERS, presentDataSource } from '../sync/registry';
import { runSync } from '../sync/syncService';

const router = Router();

/** GET /data-sources — 返回所有已知 provider 的连接状态(无记录则默认 disconnected) */
router.get('/', async (_req, res) => {
  const rows = await prisma.dataSource.findMany({ where: { userId: USER_ID } });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const result = KNOWN_PROVIDERS.map((provider) => presentDataSource(provider, byProvider.get(provider)));
  return ok(res, result);
});

/** POST /data-sources/:provider/connect */
router.post('/:provider/connect', async (req, res) => {
  const { provider } = req.params;
  if (!isSupported(provider)) return err(res, 400, '未支持的 provider');

  const adapter = getAdapter(provider);
  await adapter.connect(req.body?.credentials);

  const ds = await prisma.dataSource.upsert({
    where: { userId_provider: { userId: USER_ID, provider } },
    create: { userId: USER_ID, provider, name: providerName(provider), status: 'connected' },
    update: { status: 'connected', lastError: null }
  });
  return ok(res, ds);
});

/** POST /data-sources/:provider/sync — 触发增量同步 */
router.post('/:provider/sync', async (req, res) => {
  const { provider } = req.params;
  if (!isSupported(provider)) return err(res, 400, '未支持的 provider');

  try {
    const result = await runSync(USER_ID, provider);
    if (result.status === 'error') {
      return err(res, 502, `同步失败: ${result.error}`, { affectsData: false, code: 502 });
    }
    return ok(res, result);
  } catch (e) {
    return err(res, 500, (e as Error).message, { affectsData: false });
  }
});

/** POST /data-sources/:provider/disconnect */
router.post('/:provider/disconnect', async (req, res) => {
  const { provider } = req.params;
  const ds = await prisma.dataSource.findUnique({
    where: { userId_provider: { userId: USER_ID, provider } }
  });
  if (!ds) return ok(res, { provider, status: 'disconnected' });

  if (isSupported(provider)) {
    try {
      await getAdapter(provider).disconnect();
    } catch {
      /* 断开容错 */
    }
  }
  const updated = await prisma.dataSource.update({
    where: { id: ds.id },
    data: { status: 'disconnected' }
  });
  return ok(res, updated);
});

export default router;
