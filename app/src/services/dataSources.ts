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

/** POST /data-sources/wechat/sync — 推送微信运动加密步数包,后端解密入库 */
export const syncWechatRun = (encryptedData: string, iv: string) =>
  request<{ status: SyncStatus; lastSyncAt: string; syncedCount: number }>({
    url: '/data-sources/wechat/sync',
    method: 'POST',
    data: { encryptedData, iv }
  });

/** DELETE-like:断开(用 POST 断开端点,小程序避免 DELETE 语义问题) */
export const disconnectProvider = (provider: Provider) =>
  request<DataSource>({ url: `/data-sources/${provider}/disconnect`, method: 'POST' });
