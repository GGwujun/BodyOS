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
  if (!env.zhipuApiKey) throw new Error('AI 服务尚未配置，请配置有效凭据后重试');

  const url = `${env.zhipuBaseUrl.replace(/\/$/, '')}${MESSAGES_PATH}`;
  const body = {
    model: env.zhipuModel,
    ...(opts.system ? { system: opts.system } : {}),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.3,
    top_p: opts.topP ?? 0.9,
    max_tokens: opts.maxTokens ?? 1024
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
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 429) throw new Error('AI 服务额度不足或正在限流，请检查服务额度后重试');
    throw new Error(`AI 服务请求失败（${res.status}），请稍后重试或检查服务配置`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(`智谱返回错误: ${data.error.message}`);
  const text = data.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('智谱返回为空');
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
    throw new Error(`智谱返回非合法 JSON: ${cleaned.slice(0, 200)}`);
  }
}
