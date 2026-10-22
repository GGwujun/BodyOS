import Taro from '@tarojs/taro';
import { request, clearToken, getToken } from './request';
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
const base64Bytes = (s: string) => Math.floor((s.length * 3) / 4);

export const syncWechatRun = async () => {
  if (process.env.TARO_ENV !== 'weapp') throw new Error('微信运动同步请使用小程序');

  /**
   * 先登录、再取包。
   *
   * 请求层在「没有 token」时会自动补做静默登录,而登录会轮换服务端的 session_key;
   * 先 getWeRunData 再发请求的话,加密包是用旧 key 加的、服务端却拿新 key 解——必然失败。
   * 所以这里把登录提前到取包之前,尤其冷启动后第一次点同步。
   */
  if (!getToken()) {
    const { ensureLogin } = await import('./login');
    const loggedIn = await ensureLogin();
    console.info('[微信运动] 取包前登录', { loggedIn });
  }

  /**
   * 取包 + 推送。两段分开打日志:失败发生在「取不到微信运动数据」还是「服务端解密/入库」
   * 是完全不同的问题,现在只有一句 toast,线上排查时看不出在哪一环。
   * 日志里只记体积,不记加密包内容。
   *
   * allowStaleRetry:服务端回 400 表示这个加密包解不开(登录态刚轮换过/包太旧)。
   * 唯一正确的做法是**重新取包**再试一次——同一个包再推一遍不会有不同结果。
   */
  const push = async (allowStaleRetry = true): Promise<{ status: SyncStatus; lastSyncAt: string; syncedCount: number }> => {
    let w: { encryptedData: string; iv: string };
    try {
      w = await Taro.getWeRunData();
    } catch (e) {
      const raw = e as { errMsg?: string; message?: string };
      console.error('[微信运动] getWeRunData 失败', raw?.errMsg || raw?.message || e);
      throw e;
    }
    console.info('[微信运动] 已取到加密包', {
      encryptedBytes: base64Bytes(w.encryptedData || ''),
      ivBytes: base64Bytes(w.iv || '')
    });
    try {
      const res = await request<{ status: SyncStatus; lastSyncAt: string; syncedCount: number }>({
        url: '/data-sources/wechat/sync',
        method: 'POST',
        data: { encryptedData: w.encryptedData, iv: w.iv },
        retried: true
      });
      console.info('[微信运动] 同步完成', { status: res.status, syncedCount: res.syncedCount });
      return res;
    } catch (e) {
      const apiErr = e as { code?: number; message?: string };
      console.error('[微信运动] 同步接口失败', { code: apiErr?.code ?? null, message: apiErr?.message ?? String(e) });
      if (allowStaleRetry && apiErr?.code === 400) {
        console.warn('[微信运动] 服务端解不开这个加密包,重新取包再试一次');
        return push(false);
      }
      throw e;
    }
  };
  try {
    return await push();
  } catch (e) {
    if ((e as { code?: number })?.code !== 401) throw e;
    console.warn('[微信运动] 登录态失效,重新登录后重取加密包');
    clearToken();
    const { ensureLogin } = await import('./login');
    if (!(await ensureLogin())) throw e;
    return push(); // 重登后 session_key 已更新,必须重新取包
  }
};

/** DELETE-like:断开(用 POST 断开端点,小程序避免 DELETE 语义问题) */
export const disconnectProvider = (provider: Provider) =>
  request<DataSource>({ url: `/data-sources/${provider}/disconnect`, method: 'POST' });
