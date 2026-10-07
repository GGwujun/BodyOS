import Taro from '@tarojs/taro';
import { config } from '@/config';
import { setToken, getToken } from './request';
import type { ApiResponse } from './types';

/**
 * 微信静默登录:wx.login 拿 code → 后端 code2session 换 openid → 存 token。
 * 仅 weapp 有效(H5 开发不登录,服务端回落单用户)。
 * 失败静默吞掉:不阻塞启动,后续请求走无 token 回落。
 */
export async function ensureLogin(force = false): Promise<boolean> {
  if (process.env.TARO_ENV !== 'weapp') return false;
  if (!force && getToken()) return true; // 已有 token,启动时跳过重复登录

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
