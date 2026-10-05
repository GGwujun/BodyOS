import Taro from '@tarojs/taro';
import { config } from '@/config';
import type { ApiResponse, ApiError } from './types';
import { responseError } from './responseError';

/**
 * 统一请求封装
 * - 自动拼接 apiBase
 * - 注入 token
 * - 解包 ApiResponse,失败抛 ApiError
 * - AI 类长请求支持独立超时
 */
export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, unknown> | object;
  header?: Record<string, string>;
  /** 是否为 AI 长请求(使用 aiTimeout) */
  ai?: boolean;
  /** 是否直接返回原始 res(不按 ApiResponse 解包) */
  raw?: boolean;
}

const TOKEN_KEY = 'bodyos_token';

export function getToken(): string {
  return Taro.getStorageSync(TOKEN_KEY) || '';
}

export function setToken(token: string) {
  Taro.setStorageSync(TOKEN_KEY, token);
}

export function clearToken() {
  Taro.removeStorageSync(TOKEN_KEY);
}

function buildHeader(custom?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...custom
  };
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function request<T = unknown>(opts: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, header, ai = false, raw = false } = opts;
  try {
    const res = await Taro.request({
      url: url.startsWith('http') ? url : `${config.apiBase}${url}`,
      method,
      data,
      header: buildHeader(header),
      timeout: ai ? config.aiTimeout : config.timeout
    });

    if (res.statusCode >= 400) {
      throw responseError(res.statusCode,res.data);
    }

    if (raw) return res.data as T;

    const body = res.data as ApiResponse<T>;
    if (body && typeof body.code === 'number' && body.code !== 0) {
      throw responseError(body.code,body);
    }
    // 兼容未包装的直接返回
    return (body && 'data' in body ? body.data : (body as unknown)) as T;
  } catch (e) {
    // 统一规整为 ApiError,便于页面 catch
    const err = (e as ApiError)?.message
      ? (e as ApiError)
      : { code: -1, message: '网络异常,请稍后重试' };
    throw err;
  }
}
