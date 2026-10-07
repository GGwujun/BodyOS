/**
 * 面向用户的业务错误。
 *
 * 默认约定:路由 catch 到的异常一律回"服务暂时不可用"并打印服务端日志,
 * 防止 Prisma 表名/上游原始输出等内部信息外泄;
 * 只有明确标记为 UserError 的异常(消息本身写给用户看)才原样返回。
 */
export class UserError extends Error {}

export function isUserError(e: unknown): e is UserError {
  return e instanceof UserError;
}

/** 服务端留痕 + 返回统一兜底文案(给路由 catch 用) */
export function fallbackMessage(context: string, e: unknown): string {
  console.error(`[${context}]`, e);
  return '服务暂时不可用，请稍后重试';
}
