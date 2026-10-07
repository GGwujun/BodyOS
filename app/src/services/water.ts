import { request } from './request';
import type { WaterStatus } from './types';

/** GET /water?date= — 当日水量与目标 */
export const getWater = (date: string) =>
  request<WaterStatus>({ url: `/water?date=${encodeURIComponent(date)}` });

/** POST /water — 打卡累加(毫升) */
export const addWater = (amountMl: number, date?: string) =>
  request<WaterStatus>({ url: '/water', method: 'POST', data: { amountMl, date } });

/** PUT /water — 直接设置当日总量(改错/补录) */
export const setWater = (amountMl: number, date?: string) =>
  request<WaterStatus>({ url: '/water', method: 'PUT', data: { amountMl, date } });
