import Taro from '@tarojs/taro';
import { config } from '@/config';
import { setToken } from './request';
import type { ApiResponse } from './types';

/**
 * 微信静默登录:wx.login 拿 code → 后端 code2session 换 openid → 存 token。
 * 仅 weapp 有效(H5 开发不登录,服务端回落单用户)。
 * 失败静默吞掉:不阻塞启动,后续请求走无 token 回落。
 *
 * 每次调用都重新登录(不因已有 token 跳过):
 * - 刷新服务端保存的 session_key(微信运动解密依赖,旧密钥会解不开新数据);
 * - 让"登录会话已更新/已过期"类异常在重启小程序后自动恢复。
 * 并发调用去重:同一时刻只发一次 wx.login,共享同一个 Promise。
 */
let inflight: Promise<boolean> | null = null;

export function ensureLogin(): Promise<boolean> {
  if (process.env.TARO_ENV !== 'weapp') return Promise.resolve(false);
  if (!inflight) {
    inflight = login().finally(() => { inflight = null; });
  }
  return inflight;
}

async function login(): Promise<boolean> {
  try {
    const { code } = await Taro.login();
    const res = await Taro.request({
      url: `${config.apiBase}/auth/wechat`,
      method: 'POST',
      data: { code },
      header: { 'Content-Type': 'application/json' },
      timeout: config.timeout
    });
    if (res.statusCode >= 400) return false;
    const body = res.data as ApiResponse<{ token: string }>;
    const token = body && typeof body === 'object' && 'data' in body
      ? body.data?.token
      : (body as { token?: string })?.token;
    if (!token) return false;
    setToken(token);
    return true;
  } catch {
    return false;
  }
}
