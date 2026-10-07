/**
 * 日期工具:统一用本地时区的 YYYY-MM-DD,避免 @db.Date 时区偏移。
 */

/** 从任意时间取 YYYY-MM-DD(本地时区) */
export function toDateStr(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * YYYY-MM-DD → 当天 00:00 UTC 的 Date。
 * 用 UTC 构造,避免 @db.Date 在本地时区偏移下落到前一天。
 * toStr/fromStr 配对使用,保证 dateStr → Date → dateStr 往返一致。
 */
export function toDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 今天的 YYYY-MM-DD(本地时区,与用户感知一致) */
export function todayStr(): string {
  return toDateStr(new Date());
}

/** 校验是 YYYY-MM-DD 且为真实日历日期(防脏参数进 toDate 产生 Invalid Date 打挂 Prisma) */
export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 指定日期加减 N 天,返回新的 dateStr */
export function addDays(dateStr: string, n: number): string {
  const d = toDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** 从出生日期算年龄(周岁) */
export function ageFromBirth(birth: Date | null | undefined): number | null {
  if (!birth) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}
