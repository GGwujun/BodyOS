import { request } from './request';
import type { DailySummary, DailyAnalysis, WeeklyAnalysis } from './types';

/** GET /daily-summary?date=YYYY-MM-DD */
export const getDailySummary = (date: string) =>
  request<DailySummary>({ url: `/daily-summary?date=${encodeURIComponent(date)}` });

/** POST /ai/daily-analysis — 结论/依据/行动(后端取数据,前端只传 date) */
export const dailyAnalysis = (date: string) =>
  request<DailyAnalysis>({ url: '/ai/daily-analysis', method: 'POST', data: { date }, ai: true });

/** POST /ai/weekly-analysis — 周报(同周命中服务端缓存;regenerate 强制重生成) */
export const weeklyAnalysis = (weekStart: string, regenerate = false) =>
  request<WeeklyAnalysis>({ url: '/ai/weekly-analysis', method: 'POST', data: { weekStart, regenerate }, ai: true });
