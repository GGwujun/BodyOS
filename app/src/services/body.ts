import { request } from './request';
import type { BodyMeasurement, PageResult } from './types';

/** GET /body-measurements */
export const listBodyMeasurements = () =>
  request<PageResult<BodyMeasurement>>({ url: '/body-measurements' });

/** POST /body-measurements(若有体重,后端同步更新 profile) */
export interface BodyInput {
  measuredAt: string;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  muscleKg?: number | null;
}
export const createBodyMeasurement = (data: BodyInput) =>
  request<BodyMeasurement>({ url: '/body-measurements', method: 'POST', data });

/** DELETE /body-measurements/:id */
export const deleteBodyMeasurement = (id: string) =>
  request<{ deleted: boolean }>({ url: `/body-measurements/${id}`, method: 'DELETE' });
