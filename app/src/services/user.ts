import { request } from './request';
import type { User, Profile, Goal } from './types';

/** GET /me */
export const getMe = () => request<User>({ url: '/me' });

/** PUT /me — 保存昵称(头像昵称填写能力,微信不再允许自动获取) */
export const updateMe = (data: { nickname: string }) =>
  request<User>({ url: '/me', method: 'PUT', data });

/** GET /profile */
export const getProfile = () => request<Profile>({ url: '/profile' });

/** PUT /profile */
export const updateProfile = (data: Partial<Profile>) =>
  request<Profile>({ url: '/profile', method: 'PUT', data });

/** GET /goals */
export const listGoals = () => request<Goal[]>({ url: '/goals' });

export interface GoalInput {
  type: 'fat_loss' | 'muscle_gain' | 'maintain' | 'endurance';
  targetValue: number;
  unit: string;
  durationWeeks?: number;
  isActive?: boolean;
}

/** POST /goals */
export const createGoal = (data: GoalInput) =>
  request<Goal>({ url: '/goals', method: 'POST', data });

/** PUT /goals/:id */
export const updateGoal = (id: string, data: Partial<GoalInput>) =>
  request<Goal>({ url: `/goals/${id}`, method: 'PUT', data });

/** DELETE /goals/:id — 归档 */
export const archiveGoal = (id: string) =>
  request<{ archived: boolean }>({ url: `/goals/${id}`, method: 'DELETE' });
