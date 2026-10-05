import { request } from './request';
import type { ChatInput, ChatResult } from './types';

/** POST /ai/chat — AI 教练对话(后端从 DB 拼历史,前端只传当前问题) */
export const chat = (input: ChatInput) =>
  request<ChatResult>({ url: '/ai/chat', method: 'POST', data: input, ai: true });

/** GET /ai/chat/history — 拉取历史对话 */
export interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
export const listHistory = (limit = 20) =>
  request<HistoryMessage[]>({ url: `/ai/chat/history?limit=${limit}` });
