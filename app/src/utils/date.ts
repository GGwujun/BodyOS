/**
 * 前端日期工具:用本地时区取 YYYY-MM-DD,与后端 lib/date.todayStr 对齐。
 * 避免在 UTC+8 凌晨用 toISOString().slice(0,10) 取到前一天。
 *
 * 全站的「一天」「一周」都从这里定义 —— 尤其 **周一是一周的第一天** 这一条:
 * 训练热力图、体重周均值、请假、提醒都在按周分桶,各写一份迟早会出现
 * 「热力图算这周、周均值算下周」这种对不上的错。
 */

/** Date → YYYY-MM-DD(本地时区) */
export function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 今天的 YYYY-MM-DD(本地时区) */
export function todayStr(): string {
  return isoOf(new Date());
}

/** YYYY-MM-DD → 当地零点的 Date(别用 new Date('2026-10-01'),那是 UTC) */
export function parseDay(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

/**
 * 相差几天(按日历天,避开夏令时)。
 * 正数 = `to` 在 `from` 之后;同一天为 0。
 */
export function dayDiff(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86400000);
}

/** 加减天数(传负数就是往前) */
export function addDays(date: string, days: number): string {
  const d = parseDay(date);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** 这一天所在周的周一(YYYY-MM-DD)。周日算上一周的最后一天。 */
export function mondayOf(date: string): string {
  const d = parseDay(date);
  const back = (d.getDay() + 6) % 7;   // 周一 = 0
  d.setDate(d.getDate() - back);
  return isoOf(d);
}

/** 当前 ISO 时间(用于 POST 的 startedAt/measuredAt) */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * 服务端时间戳(UTC 的 ISO 串)→ **本地**那一天的 YYYY-MM-DD。
 *
 * 别用 `iso.slice(0, 10)` 代替它:那是 UTC 那天。东八区早上 8 点前,
 * 本地日期比 UTC 日期大一天 —— 于是早上 7 点称的体重记到昨天、凌晨设的目标
 * 写成前天、「今天记过没有」判断成没记过。这一层只留在这一个函数里。
 */
export function localDayOf(iso: string): string {
  return isoOf(new Date(iso));
}
