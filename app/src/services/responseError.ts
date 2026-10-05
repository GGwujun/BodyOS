import type { ApiError } from './types';

export function responseError(status: number, payload: unknown): ApiError {
  const body=payload&&typeof payload==='object'?payload as Record<string,unknown>:{};
  return {
    code:typeof body.code==='number'&&body.code!==0?body.code:status,
    message:typeof body.message==='string'&&body.message.trim()?body.message:`请求失败（${status}）`,
    ...(typeof body.affectsData==='boolean'?{affectsData:body.affectsData}:{})
  };
}
