import { prisma } from '../db';
import { toDateStr, toDate } from '../lib/date';
import { recomputeDaily } from '../engine';
import { getAdapter, providerName } from './registry';
import type { NormalizedRecord } from './types';

/**
 * 执行某 provider 的完整同步流程(tech/03):
 * Fetch Incremental → Persist Raw → (normalize 已在 adapter 内) → Validate/Dedup → Upsert Canonical → Recalculate → Update Cursor
 */
export async function runSync(userId: string, provider: string): Promise<{
  status: 'synced' | 'error';
  lastSyncAt: string;
  syncedCount: number;
  error?: string;
}> {
  const adapter = getAdapter(provider);

  // 确保有 DataSource 行
  let ds = await ensureDataSourceRow(userId, provider);

  await prisma.dataSource.update({
    where: { id: ds.id },
    data: { status: 'syncing', lastError: null }
  });

  try {
    // 1. adapter.sync(带重试)
    const result = await withRetry(() => adapter.sync(ds!.cursor ?? undefined));
    return await persistSyncRecords(userId, provider, result.records, result.cursor);
  } catch (e) {
    await markError(ds.id, (e as Error).message);
    return errorResult((e as Error).message);
  }
}

/**
 * 客户端推送式同步(微信运动等):数据由小程序端取回后 POST 上来,
 * 走与拉取式完全相同的入库链路(Raw 保留 → 幂等 upsert → 重算 → 更新游标)。
 */
export async function runPushSync(
  userId: string,
  provider: string,
  records: NormalizedRecord[]
): Promise<{
  status: 'synced' | 'error';
  lastSyncAt: string;
  syncedCount: number;
  error?: string;
}> {
  await ensureDataSourceRow(userId, provider);
  try {
    return await persistSyncRecords(userId, provider, records);
  } catch (e) {
    const ds = await prisma.dataSource.findUnique({
      where: { userId_provider: { userId, provider } }
    });
    if (ds) await markError(ds.id, (e as Error).message);
    return errorResult((e as Error).message);
  }
}

/** 共享:确保 DataSource 行存在并返回 */
async function ensureDataSourceRow(userId: string, provider: string) {
  const existing = await prisma.dataSource.findUnique({
    where: { userId_provider: { userId, provider } }
  });
  return existing
    ? existing
    : prisma.dataSource.create({
        data: { userId, provider, name: providerName(provider), status: 'connecting' }
      });
}

/** 共享:Raw 保留 → 幂等 upsert Canonical → 重算受影响日期 → 更新游标/状态 */
async function persistSyncRecords(userId: string, provider: string, records: NormalizedRecord[], cursor?: string) {
  const ds = await ensureDataSourceRow(userId, provider);

  let upserted = 0;
  const affectedDates = new Set<string>();

  for (const rec of records) {
    // 保留 raw
    await prisma.syncRawRecord.upsert({
      where: {
        userId_provider_externalId: { userId, provider, externalId: rec.externalId }
      },
      create: { userId, provider, externalId: rec.externalId, payload: rec as never },
      update: { payload: rec as never, fetchedAt: new Date() }
    });

    // upsert canonical
    const startedAt = new Date(rec.startedAt);
    const dateStr = toDateStr(startedAt);
    await prisma.activityRecord.upsert({
      where: {
        userId_provider_externalId: { userId, provider, externalId: rec.externalId }
      },
      create: {
        userId,
        provider,
        externalId: rec.externalId,
        date: toDate(dateStr),
        type: rec.type,
        durationMin: rec.durationMin,
        calories: rec.calories,
        steps: rec.steps,
        startedAt,
        source: provider,
        confidence: rec.confidence ?? null
      },
      update: {
        type: rec.type,
        durationMin: rec.durationMin,
        calories: rec.calories,
        steps: rec.steps,
        startedAt,
        confidence: rec.confidence ?? null
      }
    });
    upserted++;
    affectedDates.add(dateStr);
  }

  // 重算受影响日期
  for (const d of affectedDates) {
    await recomputeDaily(userId, d);
  }

  // 更新 cursor
  const now = new Date();
  await prisma.dataSource.update({
    where: { id: ds.id },
    data: {
      status: 'synced',
      cursor: cursor ?? now.toISOString(),
      lastSyncAt: now,
      lastError: null
    }
  });

  return { status: 'synced' as const, lastSyncAt: now.toISOString(), syncedCount: upserted };
}

async function markError(dsId: string, message: string) {
  await prisma.dataSource.update({
    where: { id: dsId },
    data: { status: 'error', lastError: message }
  });
}

function errorResult(message: string) {
  return { status: 'error' as const, lastSyncAt: new Date().toISOString(), syncedCount: 0, error: message };
}

/** 指数退避重试 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseMs = 1000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < maxRetries - 1) {
        await sleep(baseMs * 2 ** i);
      }
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
