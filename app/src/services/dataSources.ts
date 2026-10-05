import { request } from './request';
import type { DataSource, Provider, SyncStatus } from './types';

/** GET /data-sources */
export const listDataSources = () => request<DataSource[]>({ url: '/data-sources' });

/** POST /data-sources/{provider}/connect */
export const connectProvider = (provider: Provider) =>
  request<DataSource>({ url: `/data-sources/${provider}/connect`, method: 'POST' });

/** POST /data-sources/{provider}/sync — 触发增量同步 */
export const syncProvider = (provider: Provider) =>
  request<{ status: SyncStatus; lastSyncAt: string }>({
    url: `/data-sources/${provider}/sync`,
    method: 'POST'
  });

/** DELETE-like:断开(用 POST 断开端点,小程序避免 DELETE 语义问题) */
export const disconnectProvider = (provider: Provider) =>
  request<DataSource>({ url: `/data-sources/${provider}/disconnect`, method: 'POST' });
