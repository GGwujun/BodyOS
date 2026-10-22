import { Router } from 'express';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { getAdapter, isSupported, providerName, KNOWN_PROVIDERS, presentDataSource } from '../sync/registry';
import { runSync, runPushSync } from '../sync/syncService';
import { decryptWeRunData, weRunToRecords, WECHAT_PROVIDER } from '../sync/adapters/wechat';
import { wrap } from '../lib/asyncHandler';
import { isUserError, fallbackMessage } from '../lib/userError';
import { base64Bytes, logError, logInfo, logWarn } from '../lib/log';

const router = Router();

/**
 * 该用户最新一次微信登录留下的 session_key。
 *
 * 微信的 session_key 按 openid **全局轮换**:任何一次 code2session(包括另一台设备、
 * 开发者工具、小程序冷启动)都会让旧的失效。而 getWeRunData 的加密包用的是微信当前
 * 那一版 key —— 所以解密必须用「最新登录」的 key,不能只看请求所带令牌里存的那份,
 * 否则换过设备/重进过小程序之后,同步会稳定报「步数数据已过期」。
 */
async function latestWechatSession(userId: string): Promise<{ sessionKey: string; issuedAt: string } | null> {
  const row = await prisma.authToken.findFirst({
    where: { userId, sessionKey: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { sessionKey: true, createdAt: true }
  });
  if (!row?.sessionKey) return null;
  return { sessionKey: row.sessionKey, issuedAt: row.createdAt.toISOString() };
}

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
      const locals = res.locals as Record<string, unknown>;
      const tokenIssuedAt = (locals.sessionIssuedAt as string | undefined) ?? null;

      logInfo('sync.wechat', '收到微信运动同步', {
        userId,
        encryptedBytes: base64Bytes(encryptedData),
        ivBytes: base64Bytes(iv),
        tokenIssuedAt,
        hasTokenSessionKey: Boolean(locals.sessionKey)
      });

      if (!encryptedData || !iv) {
        logWarn('sync.wechat', '请求缺少加密包或 iv', { userId });
        return err(res, 400, '缺少微信运动数据，请在小程序端发起同步', { affectsData: false });
      }

      // 优先用最新一次登录的 key:令牌里那份可能已被后续登录轮换掉
      const latest = await latestWechatSession(userId);
      const sessionKey = latest?.sessionKey ?? (locals.sessionKey as string | undefined);
      if (!sessionKey) {
        logWarn('sync.wechat', '没有可用 session_key', { userId, tokenIssuedAt });
        return err(res, 401, '登录会话已更新，请重新进入后再同步', { affectsData: false });
      }
      const keyIssuedAt = latest?.issuedAt ?? tokenIssuedAt;
      logInfo('sync.wechat', '使用会话解密', {
        userId,
        keySource: latest ? 'latest-login' : 'current-token',
        keyIssuedAt,
        rotatedAfterToken: Boolean(latest && tokenIssuedAt && latest.issuedAt !== tokenIssuedAt)
      });

      let stepList;
      try {
        stepList = decryptWeRunData(sessionKey, iv, encryptedData);
      } catch (e) {
        // session_key 与加密包不匹配(AES 解不开/格式错)多为登录态轮换残留,提示重试而非报内部错误
        logError('sync.wechat', '解密失败(session_key 与加密包不匹配)', e, {
          userId,
          keyIssuedAt,
          tokenIssuedAt,
          encryptedBytes: base64Bytes(encryptedData),
          ivBytes: base64Bytes(iv)
        });
        return err(res, 400, '步数数据已过期，请重新点击同步', { affectsData: false });
      }

      const validSteps = stepList.filter((s) => Number.isFinite(s.step) && Number.isFinite(s.timestamp));
      const totalSteps = validSteps.reduce((sum, s) => sum + Math.max(0, s.step), 0);
      const firstTs = validSteps.length ? new Date(Math.min(...validSteps.map((s) => s.timestamp)) * 1000) : null;
      const lastTs = validSteps.length ? new Date(Math.max(...validSteps.map((s) => s.timestamp)) * 1000) : null;
      logInfo('sync.wechat', '解密成功', {
        userId,
        days: stepList.length,
        validDays: validSteps.length,
        totalSteps,
        firstDay: firstTs ? firstTs.toISOString().slice(0, 10) : null,
        lastDay: lastTs ? lastTs.toISOString().slice(0, 10) : null
      });

      const profile = await prisma.userProfile.findUnique({ where: { userId } });
      const records = weRunToRecords(stepList, profile?.weightKg ?? null);
      logInfo('sync.wechat', '开始入库', { userId, records: records.length, weightKg: profile?.weightKg ?? null });
      result = await runPushSync(userId, provider, records);
    } else {
      result = await runSync(userId, provider);
    }

    if (result.status === 'error') {
      logError('sync', 'provider 同步失败', undefined, { provider, userId, error: result.error ?? null });
      return err(res, 502, '同步失败，请稍后重试', { affectsData: false, code: 502 });
    }
    logInfo('sync', '同步完成', {
      provider,
      userId,
      status: result.status,
      syncedCount: result.syncedCount,
      lastSyncAt: result.lastSyncAt
    });
    return ok(res, result);
  } catch (e) {
    logError('sync', '同步接口异常', e, { provider, userId });
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
