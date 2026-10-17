/**
 * 训练提醒的发送时机 —— 纯函数,不碰数据库也不碰微信接口,这样能单测。
 *
 * 一个绕不开的事实:**小程序的订阅消息只能由服务端发**,客户端离开小程序后没有任何
 * 执行机会。所以「晚上 8 点提醒我练」这句话要落到服务器上才算数。
 *
 * 由此带来两个必须处理的东西:
 *  1. **时区**。服务器跑在 UTC,用户说的 8 点是**他那边的** 8 点。所以设置里存了
 *     客户端的时区偏移(东八区 480),这里按它把「此刻」换算成用户本地的挂钟时间。
 *     用户出差换时区时,客户端会在下次保存设置时上报新的偏移。
 *  2. **一天一条 + 迟到就闭嘴**。调度器可能重启、可能被卡住,晚了几个小时才轮到这条
 *     提醒是常事 —— 凌晨三点推一条「今天该练了」比不推更糟。所以超过宽限窗口
 *     (默认 6 小时)就当这条错过了,直接跳过,等明天的正常时间。
 */
/** 一条待判定的提醒设置(只取用得上的字段,便于单测) */
export interface ReminderRow {
  id: string;
  enabled: boolean;
  /** 本地时间的 HH:mm */
  time: string;
  /**
   * 客户端时区相对 UTC 的分钟数(东八区 = 480)。
   * 注意不是 JS `getTimezoneOffset()` 的 -480 —— 那是反向的,别用混了。
   */
  tzOffsetMin: number;
  /** 还剩几条订阅消息能发 */
  grants: number;
  /** 最后一次发出的用户本地日期 */
  lastSentOn: string | null;
}

/**
 * 默认宽限:比预定时间晚这么多就不再补发。
 * 注意实际窗口比它更短 —— 判断用的是当天的第几分钟,过了用户本地的午夜就归零、
 * 小于目标时刻,自然算作「今天这一段已经结束」,不会跨到第二天。
 * 于是 20:00 的提醒最晚在 23:59 发出去:凌晨三点收到「今天该练了」比收不到更糟。
 */
export const SEND_GRACE_MIN = 6 * 60;

// 小时和分钟**都要是捕获组**:下面的 hhmmToMin 要分别取出来算分钟数
export const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 用户本地的挂钟时间(用 UTC 取数就是本地读法) */
export function localClock(nowMs: number, tzOffsetMin: number): Date {
  return new Date(nowMs + tzOffsetMin * 60000);
}

/** 用户本地的 YYYY-MM-DD */
export function localDay(nowMs: number, tzOffsetMin: number): string {
  const d = localClock(nowMs, tzOffsetMin);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 'HH:mm' → 当天第几分钟;格式不对返回 null */
export function hhmmToMin(v: string): number | null {
  const m = HHMM_RE.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * 这条提醒现在该不该发。四个条件缺一不可:
 * 开着、还有可发次数、今天还没发过、而且已经到了本地时间且没超出宽限。
 */
export function dueNow(row: ReminderRow, nowMs: number, graceMin = SEND_GRACE_MIN): boolean {
  if (!row.enabled || row.grants <= 0) return false;
  const target = hhmmToMin(row.time);
  if (target == null) return false; // 存了脏时间就不发,而不是猜一个

  const tz = Number.isFinite(row.tzOffsetMin) ? row.tzOffsetMin : 480;
  const day = localDay(nowMs, tz);
  if (row.lastSentOn === day) return false; // 一天最多一条

  const clock = localClock(nowMs, tz);
  const nowMin = clock.getUTCHours() * 60 + clock.getUTCMinutes();
  const late = nowMin - target;
  return late >= 0 && late <= graceMin;
}

/** 从一堆设置里挑出此刻该发的(顺序即入参顺序,便于断言) */
export function dueReminders(rows: ReminderRow[], nowMs: number, graceMin = SEND_GRACE_MIN): ReminderRow[] {
  return rows.filter((r) => dueNow(r, nowMs, graceMin));
}

/**
 * 请假条里认识的原因。**和客户端 `app/src/pkg-exercise/engine/daynote.ts` 的
 * NOTE_KINDS 是两份**(两个 package,不共享代码)—— 客户端加了新原因,
 * 这里要跟着加,否则新原因标的那天服务端照样会推消息。
 */
const NOTE_KINDS = ['sick', 'injured', 'travel', 'rest'];

/**
 * 用户本地这一天是不是请过假。
 *
 * 这是服务端唯一一处「读文档内容做判断」的地方,破例的理由很实在:
 * 到点推一条「今天该练了」给一个正在发烧的人,正是请假功能要消灭的那件事 ——
 * 只在小程序里闭嘴是不够的。代价可控:只对**此刻到点的人**查一次,不是全量扫描。
 *
 * 认不出来的一律按「没请假」处理:宁可多发一条(用户能理解),
 * 也不要因为一份读不懂的文档就把提醒永久吞掉(用户只会觉得功能坏了)。
 */
export function excusedOn(payload: unknown, localDate: string): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const v = (payload as Record<string, unknown>)[localDate];
  if (!v || typeof v !== 'object') return false;
  return NOTE_KINDS.includes((v as { kind?: string }).kind as string);
}
