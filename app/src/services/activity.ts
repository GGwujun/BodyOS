import { request } from './request';
import type { Activity, ActivityParseResult, PageResult } from './types';

/** GET /activities?date=YYYY-MM-DD */
export const listActivities = (date: string) =>
  request<PageResult<Activity>>({ url: `/activities?date=${encodeURIComponent(date)}` });

/** POST /ai/activity/parse — 自然语言解析运动 */
export const parseActivity = (text: string) =>
  request<ActivityParseResult>({
    url: '/ai/activity/parse',
    method: 'POST',
    data: { text },
    ai: true
  });

export interface ActivityInput {
  type: string;
  durationMin?: number;
  calories: number;
  steps?: number;
  startedAt: string;
  source?: string;
}

/** POST /activities(后端自行从 startedAt 取 date) */
export const createActivity = (data: ActivityInput) =>
  request<{ activity: Activity; summary: unknown }>({ url: `/activities`, method: 'POST', data });

/** PUT /activities/:id — 编辑 */
export const updateActivity = (id: string, data: Partial<ActivityInput>) =>
  request<{ activity: Activity; summary: unknown }>({ url: `/activities/${id}`, method: 'PUT', data });

/** DELETE /activities/:id — 软删除 + 重算 */
export const deleteActivity = (id: string) =>
  request<{ deleted: boolean; recalculated: unknown }>({ url: `/activities/${id}`, method: 'DELETE' });
