/**
 * 提醒调度 —— 定时看「谁到点了」,到点了推一条订阅消息。
 *
 * 客户端那边的判断(nudge.ts:今天该不该练)和这里**是两回事**:
 *   - 客户端判断「今天是不是该练」(它知道计划、日志、轮转);
 *   - 服务端只知道「用户说他晚上 8 点想被提醒」,到点就发一句话。
 * 为什么不让服务端也算一遍「该不该练」:计划是一坨会轮转的 JSON 文档、日志还在不断
 * 同步上来,服务端每 5 分钟为每个用户重算一遍既贵又容易和客户端算得不一样。
 * 提醒的价值在「到点了」,不在「精确知道今天练推还是拉」——用户点进来自然看到。
 *
 * 唯一的例外是**请假**(见 isExcusedToday):它不需要计划、只需要当天一个标记,
 * 而且漏掉的后果很具体 —— 到点推一条「今天该练了」给一个正在发烧的人。
 *
 * 每 5 分钟一轮:一轮里对每个人最多发一条(lastSentOn 按用户本地日期去重),
 * 超过宽限窗口(reminderSchedule)就直接算这条错过,等明天。
 */
import { prisma } from '../db';
import { env } from '../env';
import { dueReminders, excusedOn, localDay, type ReminderRow } from './reminderSchedule';
import { remindData, sendSubscribeMessage } from './wechatSend';

/** 轮询间隔(分钟)。提醒的精度要求不高,5 分钟够用又不费资源 */
export const TICK_MIN = 5;

/**
 * 推送文案:按语气挑一句。
 * **故意比小程序里的卡片短** —— 订阅消息一行十几个字,而服务端也不知道用户今天
 * 该练哪个训练日(见文件头),所以这里只说「该练了」。
 * 这三句和小程序 `engine/nudge.ts` 的语料是两套:那边能用「今天练推 · 胸肩三头」,
 * 这边不能。改文案时两边都要看一眼。
 */
export const PUSH_SUBJECT = '今天该练了';
export const PUSH_LINES: Record<string, string> = {
  gentle: '今天有空就练上,半小时就够。',
  fun: '你的肌肉今天想见你一面。',
  cheer: '别等了,今天这一次现在就上。'
};

export function pushLine(tone: string): string {
  return PUSH_LINES[tone] ?? PUSH_LINES.gentle;
}

export interface TickResult {
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
  /** 今天请了假,主动没发 —— 和 skipped(微信没受理)不是一回事,分开数才好排查 */
  excused: number;
}

/**
 * 今天请过假就不发(见 reminderSchedule.excusedOn)。
 * 查不到文档(新用户、还没同步过)按「没请假」处理。
 */
async function isExcusedToday(userId: string, localDate: string): Promise<boolean> {
  try {
    const doc = await prisma.trainingDoc.findUnique({
      where: { userId_kind_docKey: { userId, kind: 'daynotes', docKey: 'main' } },
      select: { payload: true }
    });
    return excusedOn(doc?.payload, localDate);
  } catch (e) {
    // 查文档失败不该把提醒整个打停:宁可多发一条,也别让所有人收不到
    console.error('[训练提醒] 读请假条失败:', e);
    return false;
  }
}

/**
 * 今天已经练过了吗?日志在云端是**一条文档一个 docKey**(kind='logs'),
 * payload 就是那条 WorkoutLog,日期在 payload.date。
 *
 * 以前只查请假条:用户白天已经练完(甚至就在小程序里记完),晚上 8 点照样收到
 * 「今天该练了」—— 这是提醒功能最伤人的一种错。计划/轮转仍然不在服务端算,
 * 但「今天有没有一条日志」是个不需要计划就能回答的事实。
 */
async function hasTrainedOn(userId: string, localDate: string): Promise<boolean> {
  try {
    const docs = await prisma.trainingDoc.findMany({
      where: { userId, kind: 'logs' },
      select: { payload: true }
    });
    return docs.some((d) => {
      const p = d.payload as { date?: unknown } | null;
      return !!p && p.date === localDate;
    });
  } catch (e) {
    console.error('[训练提醒] 读训练日志失败:', e);
    return false;
  }
}

/**
 * 跑一轮。未配置模板直接空转 —— 开发环境和没申请到模板的部署不该反复查库。
 * 允许传 `now` 是为了能测。
 */
export async function runReminderTick(now: Date = new Date()): Promise<TickResult> {
  const empty: TickResult = { checked: 0, sent: 0, failed: 0, skipped: 0, excused: 0 };
  if (!env.wechatTmplTraining) return empty;

  const rows = await prisma.trainingReminder.findMany({
    where: { enabled: true, grants: { gt: 0 } },
    include: { user: { select: { openid: true } } }
  });
  if (!rows.length) return empty;

  const candidates: ReminderRow[] = rows.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    time: r.time,
    tzOffsetMin: r.tzOffsetMin,
    grants: r.grants,
    lastSentOn: r.lastSentOn
  }));
  const due = dueReminders(candidates, now.getTime());
  const out: TickResult = { ...empty, checked: candidates.length };

  for (const row of due) {
    const full = rows.find((r) => r.id === row.id);
    const userLocalDate = localDay(now.getTime(), row.tzOffsetMin);
    // 请假优先于一切:额度不扣、不发送,明天到点照常
    if (full && (await isExcusedToday(full.userId, userLocalDate))) {
      out.excused++;
      continue;
    }
    // 今天已经练过(有一条当天的训练日志)就闭嘴,同样不扣额度
    if (full && (await hasTrainedOn(full.userId, userLocalDate))) {
      out.skipped++;
      continue;
    }
    const res = await sendSubscribeMessage(full?.user?.openid, remindData(PUSH_SUBJECT, pushLine(full?.tone ?? ''), now));

    if (res.ok) {
      out.sent++;
      await prisma.trainingReminder.update({
        where: { id: row.id },
        data: {
          grants: { decrement: 1 },
          // 记的是**用户本地日期**,否则东八区晚上 8 点这条会被算到 UTC 的前一天
          lastSentOn: userLocalDate,
          lastSentAt: now
        }
      });
      continue;
    }
    if (res.skipped) {
      out.skipped++;
      continue;
    }
    out.failed++;
    console.error('[训练提醒] 发送失败:', row.id, res.errcode, res.errmsg);
    // 43101 = 用户没授权了(或授权已用完):清掉额度,别再每 5 分钟撞一次
    if (res.errcode === 43101) {
      await prisma.trainingReminder.update({ where: { id: row.id }, data: { grants: 0 } });
    }
  }
  return out;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** 启动轮询。未配模板只打一行日志,不起定时器 */
export function startReminderTicker(): void {
  if (timer) return;
  if (!env.wechatTmplTraining) {
    console.log('   训练提醒:未配置 WECHAT_TMPL_TRAINING,订阅消息不发送(小程序内提醒照常)');
    return;
  }
  // 发送是网络请求,一轮可能超过 5 分钟;上一轮没跑完就再起一轮,
  // 两边会看到同一个 lastSentOn(还没写),同一个人被推两条。
  let ticking = false;
  const tick = () => {
    if (ticking) return;
    ticking = true;
    runReminderTick()
      .catch((e) => console.error('[训练提醒] 轮询出错:', e))
      .finally(() => { ticking = false; });
  };
  // 先跑一次:服务重启可能刚好跨过某个人的提醒时刻,别等他多等 5 分钟
  tick();
  timer = setInterval(tick, TICK_MIN * 60 * 1000);
  // 别让定时器把进程吊着(脚本/测试里尤其重要)
  timer.unref?.();
  console.log(`   训练提醒:每 ${TICK_MIN} 分钟检查一次`);
}

export function stopReminderTicker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
