/**
 * 服务端日志。
 *
 * 目的:线上出问题时要能从 `docker logs bodyos-api` 直接看出「哪个接口、哪个用户、
 * 走到哪一步、为什么失败」,而不是只有一句「服务器内部错误」。
 *
 * 红线:**不要**把 session_key / Bearer 令牌 / 加密包原文 / 密钥写进日志。
 * 需要区分会话时只记录「签发时间、长度、是否存在」这类元信息。
 */

type Detail = Record<string, unknown> | undefined;

/** 本地时区 ISO 时间(容器 TZ=Asia/Shanghai),和 nginx 日志、数据库里的操作时间对得上 */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

function prefix(level: 'INFO' | 'WARN' | 'ERROR', scope: string, message: string): string {
  return `${stamp()} ${level} [${scope}] ${message}`;
}

export function logInfo(scope: string, message: string, detail?: Detail): void {
  console.log(detail ? `${prefix('INFO', scope, message)} ${safeJson(detail)}` : prefix('INFO', scope, message));
}

export function logWarn(scope: string, message: string, detail?: Detail): void {
  console.warn(detail ? `${prefix('WARN', scope, message)} ${safeJson(detail)}` : prefix('WARN', scope, message));
}

/** 错误日志:detail 放上下文,error 放原始异常(有 stack 打 stack) */
export function logError(scope: string, message: string, error?: unknown, detail?: Detail): void {
  console.error(detail ? `${prefix('ERROR', scope, message)} ${safeJson(detail)}` : prefix('ERROR', scope, message));
  if (error !== undefined) {
    console.error(error instanceof Error ? error.stack || `${error.name}: ${error.message}` : safeJson(error));
  }
}

/** base64 字符串的实际字节数(只用于记录体积,不解码内容) */
export function base64Bytes(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  return Math.floor((value.length * 3) / 4);
}
