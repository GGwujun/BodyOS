import { markFirst } from '../utils/activation';
import { request } from './request';
import type { FoodItem, FoodLog, FoodParseInput, FoodParseResult, FrequentFood, PageResult } from './types';

/** 创建/编辑饮食记录入参(后端据此自行计算 totalCalories 与营养汇总) */
export interface FoodLogInput {
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  items: FoodItem[];
  source?: 'manual' | 'ai_text' | 'ai_image';
  loggedAt?: string;
}

/** GET /food-logs?date=YYYY-MM-DD */
/**
 * 一天的饮食记录。默认 pageSize 是 20 —— 但这一页要拿**全天**的日志算营养素合计,
 * 只取第一页的话第 21 条之后吃的东西不会进「今日蛋白/碳水/脂肪」。
 * 服务端单页上限 100,按 100 拿;一天吃到 100 条以上不是这个功能要服务的场景。
 */
export const listFoodLogs = (date: string, pageSize = 100) =>
  request<PageResult<FoodLog>>({ url: `/food-logs?date=${encodeURIComponent(date)}&pageSize=${pageSize}` });

/** GET /food-logs/frequent — 常用食物(近 30 天频次聚合) */
export const listFrequentFoods = () =>
  request<{ items: FrequentFood[] }>({ url: '/food-logs/frequent' });

/** POST /food-logs(激活埋点挂在这里,不放页面 —— 见 utils/activation.ts 的文件头) */
export const createFoodLog = async (data: FoodLogInput) => {
  const res = await request<{ foodLog: FoodLog; summary: unknown }>({ url: `/food-logs`, method: 'POST', data });
  markFirst('food');
  return res;
};

/** PUT /food-logs/:id — 编辑 */
export const updateFoodLog = (id: string, data: Partial<FoodLogInput>) =>
  request<{ foodLog: FoodLog; summary: unknown }>({ url: `/food-logs/${id}`, method: 'PUT', data });

/** DELETE /food-logs/:id — 软删除 + 重算 */
export const deleteFoodLog = (id: string) =>
  request<{ deleted: boolean; recalculated: unknown }>({ url: `/food-logs/${id}`, method: 'DELETE' });

/** POST /ai/food/parse — 文本/图片解析,返回需确认结果 */
export const parseFood = (input: FoodParseInput) =>
  request<FoodParseResult>({ url: '/ai/food/parse', method: 'POST', data: input, ai: true });
