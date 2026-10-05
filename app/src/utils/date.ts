/**
 * 前端日期工具:用本地时区取 YYYY-MM-DD,与后端 lib/date.todayStr 对齐。
 * 避免在 UTC+8 凌晨用 toISOString().slice(0,10) 取到前一天。
 */

/** 今天的 YYYY-MM-DD(本地时区) */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 当前 ISO 时间(用于 POST 的 startedAt/measuredAt) */
export function nowISO(): string {
  return new Date().toISOString();
}
