/** 同步系统类型 — 对应 tech/03 自动同步设计 */

export interface NormalizedRecord {
  externalId: string;
  type: string; // 'steps' | 'walk' | 'run' | ...
  durationMin?: number;
  calories: number;
  steps?: number;
  startedAt: string; // ISO
  confidence?: number;
}

export interface SyncResult {
  cursor?: string; // 下次同步起点
  records: NormalizedRecord[];
  fetchedCount: number;
}

/** 每个 provider 实现统一接口(tech/03) */
export interface HealthProviderAdapter {
  provider: string;
  connect(credentials?: unknown): Promise<void>;
  disconnect(): Promise<void>;
  sync(cursor?: string): Promise<SyncResult>;
}
