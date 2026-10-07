import { env } from '../env';

/**
 * 智谱 GLM 调用封装(Anthropic Messages 协议兼容端点)。
 * 端点:https://open.bigmodel.cn/api/anthropic/v1/messages
 * 文档:智谱开放平台 → Anthropic 兼容
 *
 * 仅调用真实模型；配置缺失或请求失败时返回明确错误。
 */

export interface ZhipuMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ZhipuOptions {
  system?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

const MESSAGES_PATH = '/v1/messages';


/** 调用对话补全,返回助手文本。 */
export async function chat(
  messages: ZhipuMessage[],
  opts: ZhipuOptions = {}
): Promise<string> {
  // 注意:错误消息会透传到前端用户可见界面,不得出现"AI"/供应商品牌字样。
  if (!env.zhipuApiKey) throw new Error('云端服务尚未配置，请检查服务配置后重试');

  const url = `${env.zhipuBaseUrl.replace(/\/$/, '')}${MESSAGES_PATH}`;
  const body = {
    model: env.zhipuModel,
    ...(opts.system ? { system: opts.system } : {}),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.3,
    top_p: opts.topP ?? 0.9,
    max_tokens: opts.maxTokens ?? 1024,
    // glm-4.6 是推理模型,默认先输出 thinking 块,可能耗尽 max_tokens 导致无正文。
    // 本项目的结构化解析与教练对话不需要推理,显式关闭。
    thinking: { type: 'disabled' }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.zhipuApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    // 读取并透出提供方错误详情(如 key 失效/额度不足),便于定位配置问题
    let detail = '';
    try {
      const errBody = (await res.json()) as { error?: { message?: string } | string };
      detail = typeof errBody.error === 'string' ? errBody.error : (errBody.error?.message ?? '');
    } catch { /* 非 JSON 响应体时忽略 */ }
    if (res.status === 429) throw new Error('云端服务额度不足或正在限流，请稍后重试');
    throw new Error(detail
      ? `云端服务请求失败（${res.status}）：${detail}`
      : `云端服务请求失败（${res.status}），请稍后重试或检查服务配置`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    error?: { message?: string };
  };
  if (data.error) throw new Error(`云端服务返回错误: ${data.error.message}`);
  const text = data.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error(`云端服务返回为空(stop_reason=${data.stop_reason ?? 'unknown'})`);
  return text;
}

/**
 * 调用并要求返回严格 JSON。自动剥离 ```json 围栏。
 */
export async function chatJSON<T = unknown>(
  messages: ZhipuMessage[],
  opts: ZhipuOptions = {}
): Promise<T> {
  const raw = await chat(messages, opts);
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`云端服务返回非合法 JSON: ${cleaned.slice(0, 200)}`);
  }
}
