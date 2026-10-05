import { prisma } from '../db';
import { toDateStr, toDate } from '../lib/date';
import { recomputeDaily } from '../engine';
import { getAdapter, providerName } from './registry';

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
  let ds = await prisma.dataSource.findUnique({
    where: { userId_provider: { userId, provider } }
  });
  if (!ds) {
    ds = await prisma.dataSource.create({
      data: { userId, provider, name: providerName(provider), status: 'connecting' }
    });
  }

  await prisma.dataSource.update({
    where: { id: ds.id },
    data: { status: 'syncing', lastError: null }
  });

  try {
    // 1. adapter.sync(带重试)
    const result = await withRetry(() => adapter.sync(ds!.cursor ?? undefined));

    // 2. 保留 raw + upsert canonical(靠 unique 幂等去重)
    let upserted = 0;
    const affectedDates = new Set<string>();

    for (const rec of result.records) {
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

    // 3. 重算受影响日期
    for (const d of affectedDates) {
      await recomputeDaily(userId, d);
    }

    // 4. 更新 cursor
    const now = new Date();
    await prisma.dataSource.update({
      where: { id: ds.id },
      data: {
        status: 'synced',
        cursor: result.cursor ?? now.toISOString(),
        lastSyncAt: now,
        lastError: null
      }
    });

    return { status: 'synced', lastSyncAt: now.toISOString(), syncedCount: upserted };
  } catch (e) {
    await prisma.dataSource.update({
      where: { id: ds.id },
      data: { status: 'error', lastError: (e as Error).message }
    });
    return {
      status: 'error',
      lastSyncAt: new Date().toISOString(),
      syncedCount: 0,
      error: (e as Error).message
    };
  }
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
