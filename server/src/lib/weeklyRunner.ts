/**
 * 周报推送 —— 每周一早上把**上周**的摘要推给开通了的用户。
 *
 * 和训练提醒(reminderRunner)是两条独立链路:两个模板、两份额度、两个开关。
 * 判断「到点了没」却简单得多 —— 不看用户设的几点,统一「本地周一 08:00 起发」:
 *   - localDay(now, tz) 算出用户那边的日期,weekday 是周一才可能发;
 *   - lastSentOn 记的是**那周的周一**,同一周绝不会发第二条;
 *   - 周一没赶上(服务挂了/停机)就跳过这周,不补 —— 上周的摘要周三才到,看着像出错了。
 *
 * 五个字段全部来自**已落库的数据**(DailySummary / WeeklyReport),推送前不调模型:
 * 周报正文还是用户点进小程序后按需生成,推送只负责「该看一眼了」。
 */
import { prisma } from '../db';
import { env } from '../env';
import { addDays, toDate, toDateStr } from './date';
import { localClock, localDay } from './reminderSchedule';
import { sendSubscribeMessage, weeklyData, WEEKLY_PAGE } from './wechatSend';

/** 发送时刻:本地周一 08:00。比 7 点晚是照顾「周末睡懒觉的人别被吵醒」的口径 */
export const SEND_HOUR = 8;

/** 轮询间隔(分钟)。周报对精度毫无要求,一刻钟看一次足够 */
export const TICK_MIN = 15;

/**
 * 用户本地日期是不是周一 + 时刻是否已过 08:00。
 * 拆成纯函数是为了能测「同一时刻对不同时区用户的判定」。
 */
export function dueWeeklyMonday(nowMs: number, tzOffsetMin: number): string | null {
  const clock = localClock(nowMs, tzOffsetMin);
  const day = localDay(nowMs, tzOffsetMin);
  // getUTCDay:0=周日 … 1=周一(localClock 已把时刻挪到该用户时区,读 UTC 字段就是他的本地值)
  if (clock.getUTCDay() !== 1) return null;
  if (clock.getUTCHours() < SEND_HOUR) return null;
  return day;
}

export interface WeeklyTickResult {
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * 上周摘要的五个字段(纯读库,不调模型)。
 * score 取有评分那几天的均分;体重变化取上周首末两次称重的差;
 * 亮点先看已生成的周报(用户上周自己看过全文的话 wins[0] 就是现成的),没有就留空由模板兜底。
 */
export async function weeklyDigest(
  userId: string,
  weekStart: string
): Promise<{ avgScore: number | null; weightChangeKg: number | null; recordedDays: number; highlight: string }> {
  const days = Array.from({ length: 7 }, (_, i) => toDate(addDays(weekStart, i)));
  const [summaries, weightsRaw, report] = await Promise.all([
    prisma.dailySummary.findMany({ where: { userId, date: { in: days } }, select: { date: true, bodyScore: true, intakeCalories: true, burnCalories: true, steps: true } }),
    prisma.bodyMeasurement.findMany({
      where: { userId, weightKg: { not: null }, measuredAt: { gte: toDate(weekStart), lt: toDate(addDays(weekStart, 7)) } },
      orderBy: { measuredAt: 'asc' }
    }),
    prisma.weeklyReport.findUnique({
      where: { userId_weekStart: { userId, weekStart: toDate(weekStart) } },
      select: { content: true }
    })
  ]);
  const scored = summaries.filter((s) => s.bodyScore != null);
  const avgScore = scored.length ? scored.reduce((sum, s) => sum + (s.bodyScore as number), 0) / scored.length : null;
  // 记录天数沿用趋势页口径:吃了、动了、走了哪样都算;按天去重(一天多顿只记一天)
  const recordedDays = new Set(
    summaries
      .filter((s) => s.intakeCalories > 0 || (s.burnCalories ?? 0) > 0 || s.steps > 0)
      .map((s) => toDateStr(s.date))
  ).size;

  const first = weightsRaw[0]?.weightKg;
  const last = weightsRaw[weightsRaw.length - 1]?.weightKg;
  const weightChangeKg = first != null && last != null ? Math.round((last - first) * 10) / 10 : null;

  const wins = (report?.content as { wins?: unknown } | null)?.wins;
  const highlight = Array.isArray(wins) && typeof wins[0] === 'string' ? wins[0] : '';

  return { avgScore, weightChangeKg, recordedDays, highlight };
}

/** 跑一轮。未配置模板直接空转(和训练提醒同一个降级规矩)。 */
export async function runWeeklyTick(now: Date = new Date()): Promise<WeeklyTickResult> {
  const empty: WeeklyTickResult = { checked: 0, sent: 0, failed: 0, skipped: 0 };
  if (!env.wechatTmplWeekly) return empty;

  const rows = await prisma.weeklyPushSetting.findMany({
    where: { enabled: true, grants: { gt: 0 } },
    include: { user: { select: { openid: true } } }
  });
  if (!rows.length) return empty;
  const out: WeeklyTickResult = { ...empty, checked: rows.length };

  for (const row of rows) {
    const monday = dueWeeklyMonday(now.getTime(), row.tzOffsetMin);
    // 不是(用户本地的)周一上午,或者这一周已经发过 → 不动
    if (!monday || row.lastSentOn === monday) continue;

    // 报告的是上一周:monday 往回 7 天那一周
    const weekStart = toDateStr(addDays(monday, -7));
    const digest = await weeklyDigest(row.userId, weekStart);
    const res = await sendSubscribeMessage(
      row.user?.openid,
      weeklyData({ weekStart, ...digest }),
      { templateId: env.wechatTmplWeekly, page: WEEKLY_PAGE }
    );

    if (res.ok) {
      out.sent++;
      await prisma.weeklyPushSetting.update({
        where: { id: row.id },
        data: { grants: { decrement: 1 }, lastSentOn: monday }
      });
      continue;
    }
    if (res.skipped) { out.skipped++; continue; }
    out.failed++;
    console.error('[周报推送] 发送失败:', row.id, res.errcode, res.errmsg);
    if (res.errcode === 43101) {
      await prisma.weeklyPushSetting.update({ where: { id: row.id }, data: { grants: 0 } });
    }
  }
  return out;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startWeeklyTicker(): void {
  if (timer) return;
  if (!env.wechatTmplWeekly) {
    console.log('   周报推送:未配置 WECHAT_TMPL_WEEKLY,不发送(周报页内查看照常)');
    return;
  }
  let ticking = false;
  const tick = () => {
    if (ticking) return;
    ticking = true;
    runWeeklyTick()
      .catch((e) => console.error('[周报推送] 轮询出错:', e))
      .finally(() => { ticking = false; });
  };
  tick();
  timer = setInterval(tick, TICK_MIN * 60 * 1000);
  timer.unref?.();
  console.log(`   周报推送:每 ${TICK_MIN} 分钟检查一次(本地周一 ${SEND_HOUR}:00 起发上周摘要)`);
}

export function stopWeeklyTicker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
