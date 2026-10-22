import { request } from './request';

/** 一晚的睡眠(没记过为 0)。记的是「昨晚」,挂在今天这个日期上 */
export interface SleepStatus {
  date: string;
  minutes: number;
}

/** GET /sleep?date= */
export const getSleep = (date: string) =>
  request<SleepStatus>({ url: `/sleep?date=${encodeURIComponent(date)}` });

/** PUT /sleep — 记/改昨晚时长(分钟),一天一条重记覆盖 */
export const setSleep = (minutes: number, date?: string) =>
  request<SleepStatus>({ url: '/sleep', method: 'PUT', data: { minutes, date } });
