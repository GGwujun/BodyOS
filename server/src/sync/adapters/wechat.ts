/**
 * 微信运动适配器。
 *
 * 数据获取方式与第三方开放平台不同:微信不提供服务端拉取接口,
 * 步数数据由小程序端 Taro.getWeRunData() 拿到加密包(encryptedData+iv),
 * POST 到 /data-sources/wechat/sync,由本模块用登录时的 session_key 解密。
 * 所以 adapter.sync() 不做拉取(抛错提示走客户端推送),注册进 REGISTRY
 * 仅为让 wechat 标记为"已支持"(连接/同步按钮可见)。
 */
import { createDecipheriv } from 'node:crypto';
import { toDateStr } from '../../lib/date';
import type { HealthProviderAdapter, NormalizedRecord } from '../types';

export const WECHAT_PROVIDER = 'wechat';

/** 微信运动单日步数条目(stepInfoList 元素) */
interface WeRunStep {
  timestamp: number; // 当天零点的 unix 秒(用户本地时区)
  step: number;
}

/** AES-128-CBC 解密 getWeRunData 的 encryptedData,得到近 30 天每日步数 */
export function decryptWeRunData(sessionKey: string, iv: string, encryptedData: string): WeRunStep[] {
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(sessionKey, 'base64'), Buffer.from(iv, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedData, 'base64')),
    decipher.final()
  ]);
  const data = JSON.parse(decrypted.toString('utf8')) as { stepInfoList?: WeRunStep[] };
  if (!Array.isArray(data.stepInfoList)) throw new Error('微信运动数据格式异常');
  return data.stepInfoList;
}

/**
 * 步数 → 标准化日粒度记录。
 * 热量按体重估算:约 0.0004 kcal/(步·kg)(70kg·8000步≈224kcal),
 * confidence 0.8 表示估算值,前端已有"估算"标注习惯。
 * 注:timestamp 为用户本地时区当天零点,externalId 用本地日期保证幂等。
 */
export function weRunToRecords(steps: WeRunStep[], weightKg: number | null): NormalizedRecord[] {
  const weight = weightKg ?? 65;
  return steps
    .filter((s) => Number.isFinite(s.step) && s.step > 0)
    .map((s) => {
      const startedAt = new Date(s.timestamp * 1000);
      return {
        externalId: `werun_${toDateStr(startedAt)}`,
        type: '步行',
        calories: Math.round(s.step * weight * 0.0004),
        steps: s.step,
        startedAt: startedAt.toISOString(),
        confidence: 0.8
      };
    });
}

export function createWechatAdapter(): HealthProviderAdapter {
  return {
    provider: WECHAT_PROVIDER,
    /** 授权即登录态本身(wx.login 已完成),无需额外凭证 */
    async connect() { /* no-op */ },
    async disconnect() { /* no-op */ },
    /** 数据由客户端推送(见 routes/dataSources.ts wechat 分支),服务端无法主动拉取 */
    async sync() {
      throw new Error('微信运动由客户端触发同步,不走服务端拉取');
    }
  };
}
