import Taro from '@tarojs/taro';
import { request, clearToken } from './request';
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

/**
 * 微信运动同步:小程序端取加密步数包,推送后端用 session_key 解密入库。
 *
 * 401(令牌过期/会话已更新)时在此自愈:重新静默登录后 **重新取加密包** 再推一次。
 * 原因:重登后 session_key 已轮换,旧加密包必然解不开,通用请求层的
 * 同体重试对这里无效——所以请求带 retried 关闭通用自愈,由本函数接管。
 */
export const syncWechatRun = async () => {
  if (process.env.TARO_ENV !== 'weapp') throw new Error('微信运动同步请使用小程序');
  const push = () => Taro.getWeRunData().then((w) =>
    request<{ status: SyncStatus; lastSyncAt: string; syncedCount: number }>({
      url: '/data-sources/wechat/sync',
      method: 'POST',
      data: { encryptedData: w.encryptedData, iv: w.iv },
      retried: true
    })
  );
  try {
    return await push();
  } catch (e) {
    if ((e as { code?: number })?.code !== 401) throw e;
    clearToken();
    const { ensureLogin } = await import('./login');
    if (!(await ensureLogin())) throw e;
    return push(); // 重登后 session_key 已更新,必须重新取包
  }
};

/** DELETE-like:断开(用 POST 断开端点,小程序避免 DELETE 语义问题) */
export const disconnectProvider = (provider: Provider) =>
  request<DataSource>({ url: `/data-sources/${provider}/disconnect`, method: 'POST' });
