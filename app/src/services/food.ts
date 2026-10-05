import { request } from './request';
import type { FoodItem, FoodLog, FoodParseInput, FoodParseResult, PageResult } from './types';

/** 创建/编辑饮食记录入参(后端据此自行计算 totalCalories 与营养汇总) */
export interface FoodLogInput {
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  items: FoodItem[];
  source?: 'manual' | 'ai_text' | 'ai_image';
  loggedAt?: string;
}

/** GET /food-logs?date=YYYY-MM-DD */
export const listFoodLogs = (date: string) =>
  request<PageResult<FoodLog>>({ url: `/food-logs?date=${encodeURIComponent(date)}` });

/** POST /food-logs */
export const createFoodLog = (data: FoodLogInput) =>
  request<{ foodLog: FoodLog; summary: unknown }>({ url: `/food-logs`, method: 'POST', data });

/** PUT /food-logs/:id — 编辑 */
export const updateFoodLog = (id: string, data: Partial<FoodLogInput>) =>
  request<{ foodLog: FoodLog; summary: unknown }>({ url: `/food-logs/${id}`, method: 'PUT', data });

/** DELETE /food-logs/:id — 软删除 + 重算 */
export const deleteFoodLog = (id: string) =>
  request<{ deleted: boolean; recalculated: unknown }>({ url: `/food-logs/${id}`, method: 'DELETE' });

/** POST /ai/food/parse — 文本/图片解析,返回需确认结果 */
export const parseFood = (input: FoodParseInput) =>
  request<FoodParseResult>({ url: '/ai/food/parse', method: 'POST', data: input, ai: true });
