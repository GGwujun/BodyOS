import { request } from './request';

/** 每日分享卡的服务端数据:当天金句(确定性轮换)+ 坚持天数 */
export interface DailyQuoteResp {
  date: string;
  quote: { text: string; sub: string; category: string };
  total: number;
  /** 注册日到今天(第几天);拉不到服务端时客户端自己算 */
  recordDays: number;
}

/** GET /daily-quote?date=YYYY-MM-DD */
export const getDailyQuote = (date: string) =>
  request<DailyQuoteResp>({ url: `/daily-quote?date=${encodeURIComponent(date)}` });

/** GET /wxacode?scene=daily — 小程序码(/media 地址,按 scene 永久缓存) */
export const getWxacode = (scene = 'daily') =>
  request<{ url: string }>({ url: `/wxacode?scene=${encodeURIComponent(scene)}` });
