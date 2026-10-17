import { markFirst } from '../utils/activation';
import { request } from './request';
import type { BodyMeasurement, PageResult } from './types';

/** GET /body-measurements(默认按测量时间倒序,可带分页参数) */
export const listBodyMeasurements = (params?: { page?: number; pageSize?: number }) => {
  const query = params
    ? `?${[`page=${params.page ?? 1}`, `pageSize=${params.pageSize ?? 20}`].join('&')}`
    : '';
  return request<PageResult<BodyMeasurement>>({ url: `/body-measurements${query}` });
};

/** POST /body-measurements(若有体重,后端同步更新 profile) */
export interface BodyInput {
  measuredAt: string;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  muscleKg?: number | null;
  /** 围度(厘米) */
  waistCm?: number | null;
  chestCm?: number | null;
  hipCm?: number | null;
  armCm?: number | null;
  thighCm?: number | null;
}
/**
 * 激活埋点挂在这里(见 utils/activation.ts):但只有**真填了体重**才算「第一次记体重」——
 * 这个函数也用来只量腰围/体脂,那不算记了一次体重。
 */
export const createBodyMeasurement = async (data: BodyInput) => {
  const res = await request<BodyMeasurement>({ url: '/body-measurements', method: 'POST', data });
  if (typeof data.weightKg === 'number' && data.weightKg > 0) markFirst('weight');
  return res;
};

/** DELETE /body-measurements/:id */
export const deleteBodyMeasurement = (id: string) =>
  request<{ deleted: boolean }>({ url: `/body-measurements/${id}`, method: 'DELETE' });
