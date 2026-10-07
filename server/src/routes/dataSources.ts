import { Router } from 'express';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { getAdapter, isSupported, providerName, KNOWN_PROVIDERS, presentDataSource } from '../sync/registry';
import { runSync, runPushSync } from '../sync/syncService';
import { decryptWeRunData, weRunToRecords, WECHAT_PROVIDER } from '../sync/adapters/wechat';
import { wrap } from '../lib/asyncHandler';
import { isUserError, fallbackMessage } from '../lib/userError';

const router = Router();

/** GET /data-sources — 已接入数据源的连接状态(未接入的不再返回,避免露出"暂未接入"占位卡片) */
router.get('/', wrap(async (_req, res) => {
  const rows = await prisma.dataSource.findMany({ where: { userId: getUserId(res) } });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const result = KNOWN_PROVIDERS
    .filter((provider) => isSupported(provider))
    .map((provider) => presentDataSource(provider, byProvider.get(provider)));
  return ok(res, result);
}));

/** POST /data-sources/:provider/connect */
router.post('/:provider/connect', wrap(async (req, res) => {
  const { provider } = req.params;
  if (!isSupported(provider)) return err(res, 400, '未支持的 provider');

  const adapter = getAdapter(provider);
  await adapter.connect(req.body?.credentials);

  const ds = await prisma.dataSource.upsert({
    where: { userId_provider: { userId: getUserId(res), provider } },
    create: { userId: getUserId(res), provider, name: providerName(provider), status: 'connected' },
    update: { status: 'connected', lastError: null }
  });
  return ok(res, ds);
}));

/** POST /data-sources/:provider/sync — 触发增量同步;微信运动为客户端推送式 */
router.post('/:provider/sync', wrap(async (req, res) => {
  const { provider } = req.params;
  if (!isSupported(provider)) return err(res, 400, '未支持的 provider');
  const userId = getUserId(res);

  try {
    let result;
    if (provider === WECHAT_PROVIDER) {
      const { encryptedData, iv } = (req.body ?? {}) as { encryptedData?: string; iv?: string };
      if (!encryptedData || !iv) {
        return err(res, 400, '缺少微信运动数据，请在小程序端发起同步', { affectsData: false });
      }
      const sessionKey = (res.locals as Record<string, unknown>).sessionKey as string | undefined;
      if (!sessionKey) {
        return err(res, 401, '登录会话已更新，请重新进入后再同步', { affectsData: false });
      }
      let stepList;
      try {
        stepList = decryptWeRunData(sessionKey, iv, encryptedData);
      } catch {
        // session_key 与加密包不匹配(AES 解不开/格式错)多为登录态轮换残留,提示重试而非报内部错误
        return err(res, 400, '步数数据已过期，请重新点击同步', { affectsData: false });
      }
      const profile = await prisma.userProfile.findUnique({ where: { userId } });
      result = await runPushSync(userId, provider, weRunToRecords(stepList, profile?.weightKg ?? null));
    } else {
      result = await runSync(userId, provider);
    }

    if (result.status === 'error') {
      console.error('[sync] provider 同步失败:', provider, result.error);
      return err(res, 502, '同步失败，请稍后重试', { affectsData: false, code: 502 });
    }
    return ok(res, result);
  } catch (e) {
    return err(res, 500, isUserError(e) ? e.message : fallbackMessage('sync', e), { affectsData: false });
  }
}));

/** POST /data-sources/:provider/disconnect */
router.post('/:provider/disconnect', wrap(async (req, res) => {
  const { provider } = req.params;
  const ds = await prisma.dataSource.findUnique({
    where: { userId_provider: { userId: getUserId(res), provider } }
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
}));

export default router;
