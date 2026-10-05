import type { Response } from 'express';

/** 统一响应包装(与前端 services/request.ts 解包约定一致) */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T | null;
  /** 错误时标注是否影响数据(docs/02) */
  affectsData?: boolean;
}

export function ok<T>(res: Response, data: T, message = 'ok') {
  const body: ApiEnvelope<T> = { code: 0, message, data };
  return res.json(body);
}

export function err(
  res: Response,
  status: number,
  message: string,
  opts: { affectsData?: boolean; code?: number } = {}
) {
  const body: ApiEnvelope<null> = {
    code: opts.code ?? status,
    message,
    data: null,
    affectsData: opts.affectsData
  };
  return res.status(status).json(body);
}
