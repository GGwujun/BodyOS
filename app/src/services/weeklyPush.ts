/**
 * 周报推送设置(服务端 /weekly-push)。
 * 和训练提醒(training.ts)同一套规矩:订阅消息只能服务端发,额度一次授权一条;
 * 这份设置跟账号走,所以存服务器,不进本机 storage。
 */
import { request } from './request';
import { tzOffsetMin } from '@/utils/reminder';

export interface WeeklyPushDto {
  enabled: boolean;
  /** 相对 UTC 的分钟数(东八区 480) */
  tzOffsetMin: number;
  /** 还能发几条 */
  grants: number;
  /** 最后一次发送对应那个周一的本地日期 */
  lastSentOn: string | null;
  /** 订阅消息模板 id;空串 = 后台还没配,推送链路是死的 */
  tmplId: string;
}

export function getWeeklyPush(): Promise<WeeklyPushDto> {
  return request<WeeklyPushDto>({ url: '/weekly-push' });
}

export function putWeeklyPush(data: { enabled: boolean; tzOffsetMin?: number }): Promise<WeeklyPushDto> {
  return request<WeeklyPushDto>({ url: '/weekly-push', method: 'PUT', data: { tzOffsetMin: tzOffsetMin(), ...data } });
}

/** 用户刚点过授权:微信一次授权只能发一条,所以是「加额度」不是「设额度」 */
export function grantWeeklyPush(accepted: number): Promise<WeeklyPushDto> {
  return request<WeeklyPushDto>({ url: '/weekly-push/grant', method: 'POST', data: { accepted } });
}
