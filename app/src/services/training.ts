/**
 * 训练数据云同步接口 —— 计划/渐进/日志/备注/器材/照片索引的云端镜像。
 * 服务端是哑存储(逐条 last-write-wins),合并规则在客户端 utils/training-sync。
 */
import { request } from './request';

// 常量在 utils:那里不依赖请求层/别名,备份与照片的冒烟测试能直接编译运行
export { mediaUrl } from '@/utils/media';

/** 一条云端文档 */
export interface TrainingDocDto {
  kind: string;
  docKey: string;
  payload: unknown;
  rev: number;
  clientUpdatedAt: string;
}

export interface PullResult {
  docs: TrainingDocDto[];
  /** 云端文档数触顶:本机历史可能比云端多,提示用户 */
  truncated?: boolean;
}

export interface PushResult {
  docs: TrainingDocDto[];
  created: number;
  updated: number;
  kept: number;
}

/** 拉取账号下全部训练文档 */
export function pullDocs(): Promise<PullResult> {
  return request<PullResult>({ url: '/training/docs' });
}

/** 推送上去的文档:rev 由服务端维护,客户端不用带 */
export type PushDoc = Omit<TrainingDocDto, 'rev'>;

/** 推送本地文档(服务端逐条 last-write-wins,返回值是落库后的最终状态) */
export function pushDocs(docs: PushDoc[]): Promise<PushResult> {
  return request<PushResult>({ url: '/training/docs', method: 'PUT', data: { docs } });
}

/** 上传一张照片(base64 或 data URL),返回相对 URL */
export function uploadMedia(data: string, mime?: string): Promise<{ url: string; bytes: number }> {
  return request<{ url: string; bytes: number }>({ url: '/training/media', method: 'POST', data: { data, mime } });
}

/**
 * 训练提醒设置。**为什么必须存服务器一份**:小程序的订阅消息只能由服务端发
 * (客户端离开小程序后没有任何执行机会,小程序也没有本地通知),服务端要按时发
 * 就得知道几点发、按哪个时区算、还剩几次可发。
 */
export interface ReminderDto {
  enabled: boolean;
  /** 本地时间的 'HH:mm' */
  time: string;
  /** gentle | fun | cheer */
  tone: string;
  /** 计划日没练的当晚再补一次 */
  nudge: boolean;
  /** 相对 UTC 的分钟数(东八区 480) */
  tzOffsetMin: number;
  /** 还能发几条 */
  grants: number;
  /** 最后一次发出的用户本地日期 */
  lastSentOn: string | null;
  /** 订阅消息模板 id;空串 = 后台还没配,推送链路是死的 */
  tmplId: string;
}

export type ReminderInput = Omit<ReminderDto, 'grants' | 'lastSentOn' | 'tmplId'>;

export function getReminder(): Promise<ReminderDto> {
  return request<ReminderDto>({ url: '/training/reminder' });
}

export function putReminder(data: ReminderInput): Promise<ReminderDto> {
  return request<ReminderDto>({ url: '/training/reminder', method: 'PUT', data });
}

/** 用户刚点过授权:微信一次授权只能发一条,所以是「加额度」不是「设额度」 */
export function grantReminder(accepted: number): Promise<ReminderDto> {
  return request<ReminderDto>({ url: '/training/reminder/grant', method: 'POST', data: { accepted } });
}
