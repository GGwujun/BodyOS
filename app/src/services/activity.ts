import { markFirst } from '../utils/activation';
import { request } from './request';
import type { Activity, ActivityParseResult, PageResult } from './types';

/** GET /activities?date=YYYY-MM-DD(默认第一页 20 条;按 externalId 找记录时要自己翻页) */
export const listActivities = (date: string, page = 1, pageSize = 100) =>
  request<PageResult<Activity>>({
    url: `/activities?date=${encodeURIComponent(date)}&page=${page}&pageSize=${pageSize}`
  });

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
  /** 距离(米)。传 null 表示**清空**(编辑时用户删掉了距离),不传表示不改 */
  distanceM?: number | null;
  /** 跑步机坡度(%) */
  inclinePct?: number | null;
  steps?: number;
  startedAt: string;
  source?: string;
  /**
   * 这条记录对应**别处**的哪一个东西(源系统的 id)。服务端只用它做去重幂等,
   * PUT 时会被忽略(见 server/src/routes/activity.ts:不允许改 externalId)。
   *
   * 现在只有一个使用者:训练模块把一条训练日志回写成一条力量训练记录时,
   * 用 `log.id` 挂在这里 —— 补录、改时长会反复调同一个回写函数,
   * 靠这个字段找到「上次写的那一条」而不是每次新建一条。
   */
  externalId?: string;
}

/**
 * POST /activities(后端自行从 startedAt 取 date;激活埋点挂在这里,见 utils/activation.ts)
 *
 * `silent` = 「这一条不是用户用了**运动**这个功能」,只是别的模块回写进来的能量账。
 * 现在唯一的使用者是训练模块(练完自动补一条力量训练记录,见
 * pkg-exercise/engine/workout-energy.ts):那笔记录该进热量引擎,但**不该**算成
 * 一次 `first_activity_log` —— 那会把「运动」这个功能的激活率算高,
 * 而激活率的分子是拿来判断要不要改这个功能本身的。留一个开关而不是另开一个
 * 写入函数:`createActivity` 必须是**唯一**的写入点,埋点才不会漏。
 */
export const createActivity = async (data: ActivityInput, opts: { silent?: boolean } = {}) => {
  const res = await request<{ activity: Activity; summary: unknown }>({ url: `/activities`, method: 'POST', data });
  if (!opts.silent) markFirst('activity');
  return res;
};

/** PUT /activities/:id — 编辑 */
export const updateActivity = (id: string, data: Partial<ActivityInput>) =>
  request<{ activity: Activity; summary: unknown }>({ url: `/activities/${id}`, method: 'PUT', data });

/** DELETE /activities/:id — 软删除 + 重算 */
export const deleteActivity = (id: string) =>
  request<{ deleted: boolean; recalculated: unknown }>({ url: `/activities/${id}`, method: 'DELETE' });
