import type { HealthProviderAdapter } from './types';

/**
 * Provider 注册表。新增真实 provider 只需实现 HealthProviderAdapter 并在此注册。
 */
const REGISTRY: Record<string, () => HealthProviderAdapter> = {};

const PROVIDER_NAMES: Record<string, string> = {
  wechat: '微信运动',
  apple_health: 'Apple 健康',
  mi: '小米运动',
  huami: '华米'
};

export function getAdapter(provider: string): HealthProviderAdapter {
  const factory = REGISTRY[provider];
  if (!factory) throw new Error(`未支持的 provider: ${provider}`);
  return factory();
}

export function isSupported(provider: string): boolean {
  return provider in REGISTRY;
}

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

export const KNOWN_PROVIDERS = Object.keys(PROVIDER_NAMES);

/** Stored authorization alone does not prove a working integration. */
export function presentDataSource(provider: string, row?: {
  status: string;
  lastSyncAt: Date | null;
  permissions: unknown;
  lastError: string | null;
}) {
  const available = isSupported(provider);
  return {
    provider,
    name: providerName(provider),
    available,
    unavailableReason: available ? null : '尚未接入真实授权与同步服务',
    hasStoredConnection: !!row && row.status !== 'disconnected',
    status: available ? row?.status ?? 'disconnected' : 'disconnected',
    lastSyncAt: available ? row?.lastSyncAt ?? null : null,
    permissions: available ? row?.permissions ?? null : null,
    lastError: available ? row?.lastError ?? null : null
  };
}
