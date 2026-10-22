import { request } from './request';

/**
 * 意见反馈 —— 只提交用户主动填写的内容。
 * 上下文里的页面/版本/机型由页面收集,用于排障;不附带任何健康数据。
 */
export interface FeedbackInput {
  kind: 'bug' | 'idea';
  content: string;
  contact?: string;
  /** 已经通过 /training/media 上传的图片地址 */
  images?: string[];
  pagePath?: string;
  appVersion?: string;
  sdkVersion?: string;
  platform?: string;
}

/** POST /feedback */
export const submitFeedback = (data: FeedbackInput) =>
  request<{ id: string }>({ url: '/feedback', method: 'POST', data });
