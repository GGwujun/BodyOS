/**
 * 把一次力量训练**翻译成热量引擎听得懂的一句话**。
 *
 * ## 为什么需要这一层
 * 热量引擎(`server/src/engine/index.ts`)算消耗时读的是 `ActivityRecord`:
 * `burnCalories = 基础代谢 + 日常活动 + 运动消耗`,而「运动消耗」=
 * **带 `durationMin` 的那些 ActivityRecord** 之和。
 *
 * 训练模块的日志不在那张表里 —— 它是 `TrainingDoc` 里的一坨 JSON
 * (`kind: 'logs'`),服务端对它「只做哑存储,不解释内容」(见 routes/training.ts 开头)。
 * 那条边界是有意的,不该为了一个估算值破掉:服务端一旦开始猜日志的语义,
 * 猜错就是静默丢数据。
 *
 * 所以翻译发生在**客户端** —— 知道「这条日志代表练了多久」的只有这里。
 * 做法是把这次训练按 `ActivityRecord` 的口径再写一条:练了多久、大约多少 kcal。
 * 这不是「同一件事存两份」:训练日志记的是**练了什么**(组数/次数/重量),
 * 活动记录记的是**消耗了多少**,两件事,谁都不是谁的派生值。
 *
 * ## 幂等
 * 一条日志对应一条活动记录,靠 `externalId = log.id` 挂钩(那个字段本来就是
 * 干这个的)。补录、改时长都会再走一遍 `syncWorkoutActivity`,先按 externalId
 * 找已有的那条,找得到就改、找不到才建 —— 反复调用不会攒出一堆重复记录。
 *
 * ## 失败了会怎样
 * 静默跳过。训练模块本身是离线优先的(数据在本地 storage,联网只是上云镜像),
 * 不能让一次网络抖动挡在「练完」这一步前面。代价是那一天少算一笔消耗,
 * 这是可接受的:宁可少算,不可挡住记录。
 */
// 按模块直接引,不走 `@/services` 那个大汇总 —— 那个桶会把 request/analytics 一路带进来,
// 而这一层要能在 smoke 里单独编译(见 tsconfig.smoke.json)
import * as activityApi from '@/services/activity';
import * as userApi from '@/services/user';
import { estimateCalories } from '@/utils/cardio';
import { addDays, localDayOf } from '@/utils/date';
import type { WorkoutLog } from './types';

/**
 * 回写记录的 `type`。**必须和运动页的类型表对得上**(`pages/exercise` 的 EX_TYPES)
 * —— 用户点进那条记录改的时候,表单要能认出是哪一项,认不出就会落成「其他」。
 */
export const STRENGTH_ACTIVITY_TYPE = '力量训练';

/** 读不到体重时按它估 —— 和运动页 `estimateCalories` 的兜底同一个数 */
const FALLBACK_WEIGHT_KG = 65;

/**
 * 体重只用来把 MET 换算成 kcal,而 MET 那档本身就有 ±30% 的误差 ——
 * 为它每次练完多打一次请求不值。会话内记一次就够(改体重是低频动作,
 * 下次冷启动自然会读到新的)。
 */
let weightCache: number | null | undefined;

async function bodyWeightKg(): Promise<number | null> {
  if (weightCache === undefined) {
    try {
      weightCache = (await userApi.getProfile())?.weightKg ?? null;
    } catch {
      // 读不到就按默认体重估,而不是不记 —— 见文件头「失败了会怎样」
      weightCache = null;
    }
  }
  return weightCache;
}

/** 这次训练大约消耗多少 kcal;时长不足以成一次训练时返回 null */
export function workoutKcal(durationSec: number, weightKg?: number | null): number | null {
  const minutes = Math.round(durationSec / 60);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return estimateCalories(STRENGTH_ACTIVITY_TYPE, minutes, weightKg);
}

/**
 * 这条活动记录的起始时间。
 *
 * 有真实开始时刻(刚练完那一次,`startedAtMs`)就用它;补录没有墙钟,
 * 退回当天中午 —— **中午是刻意的**:服务端从 `startedAt` 反推是哪一天
 * (`toDateStr` 走的是服务端本地时区),拿 00:00 或者 23:59 这种贴边的时刻,
 * 一旦两边时区差一点就会算到隔壁那天去。中午差半天也不会跨日。
 */
function startedIso(date: string, startedAtMs?: number): string {
  if (startedAtMs && Number.isFinite(startedAtMs)) {
    const at = new Date(startedAtMs);
    // 跨午夜那场:23:50 开练、00:20 收尾,日志按**收尾那天**记(date=次日),
    // 而真实 startedAt 在服务端会被归到前一天。两边日期一对不上,这条消耗就
    // 永远找不到、也改不动(第二天再同步一次就多一条)。
    // 日期一致才保留真实时刻;不一致退回当天中午,让记录和日志落在同一天。
    if (localDayOf(at.toISOString()) === date) return at.toISOString();
  }
  return new Date(`${date}T12:00:00`).toISOString();
}

export interface SyncOptions {
  /** 这一次训练真实的开始时刻(刚练完那一次有,补录没有) */
  startedAtMs?: number;
  /**
   * 这条日志**改到新日期之前**它原本是哪天。补录页允许改训练日期,而我们要找的那条
   * 活动记录还留在旧日期上 —— 不去旧日期翻一遍,就会在新日期又建一条、旧的那条
   * 永远留在原地,变成两笔消耗。
   */
  movedFrom?: string;
}

/**
 * 把一条训练日志的消耗写进热量引擎(建或改那**一条**活动记录)。
 *
 * 返回做了什么(供测试和调用方判断);没有任何可写的东西时返回 'skipped'。
 */
export async function syncWorkoutActivity(log: WorkoutLog, opts: SyncOptions = {}): Promise<'created' | 'updated' | 'skipped'> {
  const kg = await bodyWeightKg();
  const calories = workoutKcal(log.durationSec, kg ?? FALLBACK_WEIGHT_KG);
  if (calories == null) return 'skipped';
  const durationMin = Math.max(1, Math.round(log.durationSec / 60));

  try {
    // 先看这条日志在它今天的记录里有没有写过的那一笔(见文件头「幂等」)
    const mine = await findMine(log.id, log.date);
    // 没找到、而且这条日志刚换过日期:去旧日期那边翻 —— 翻到就把它**挪过来**
    const moved = mine ? null : (opts.movedFrom ? await findMine(log.id, opts.movedFrom) : null);

    if (mine || moved) {
      const patch: { durationMin: number; calories: number; startedAt?: string } = { durationMin, calories };
      // 换过日期才带上 startedAt —— 服务端由它反推归属日期,记录就跟着日志走到了新的一天。
      // 没换日期时不带:用户在运动页手动调过时间的话,不该被我们顺手改回去
      if (moved) patch.startedAt = startedIso(log.date, opts.startedAtMs);
      // 值没变就别发请求 —— 这个函数在「练完」「改时长」「补录」几条路上都会跑
      const target = mine ?? moved;
      if (!moved && target && target.durationMin === durationMin && Math.round(target.calories) === calories) {
        return 'skipped';
      }
      await activityApi.updateActivity((target as { id: string }).id, patch);
      return 'updated';
    }

    // startedAtMs 一定要传下去:漏了它,「刚练完」记录下来的那条就会退到当天中午
    // (时段信息没了,运动页里那条记录看着就像凭空出现在半夜/正午)
    await createRow(log, durationMin, calories, opts.startedAtMs);
    return 'created';
  } catch {
    return 'skipped';
  }
}

/** 新写一条活动记录。**唯一的 create 出口** —— 同步和补写都走它,口径才不会分叉 */
function createRow(log: WorkoutLog, durationMin: number, calories: number, startedAtMs?: number) {
  return activityApi.createActivity({
    type: STRENGTH_ACTIVITY_TYPE,
    durationMin,
    calories,
    startedAt: startedIso(log.date, startedAtMs),
    source: 'training',
    externalId: log.id
  }, { silent: true });   // 这不是「用了运动功能」,别算进运动激活率(见 services/activity.ts)
}

/**
 * 某一天里 externalId 等于这条日志的那条活动记录(没有就是 null)。
 *
 * **要翻完所有页**:活动列表默认一页 20 条,一天记了 20 条以上(步数同步 + 几次运动)
 * 时,训练回写的那条可能落在第二页;只查第一页会让「已经写过」被误判成「还没写」,
 * 于是再建一条同一 externalId 的记录。
 */
async function findMine(logId: string, date: string) {
  const all = await listAllActivities(date);
  return all.find((a) => a.externalId === logId) ?? null;
}

/** 某一天的全部活动(翻页到 total 或页尾),给「按 externalId 对账」用 */
async function listAllActivities(date: string) {
  const out: Awaited<ReturnType<typeof activityApi.listActivities>>['items'] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await activityApi.listActivities(date, page, 100);
    out.push(...res.items);
    if (res.items.length < 100 || page * 100 >= res.total) break;
  }
  return out;
}

/* ============================ 补写历史 ============================ */

/** 补写最多往回看几天 */
const BACKFILL_DAYS = 14;
/** 一次最多翻几个不同日期 —— 每个日期一次 GET,翻太多就成了「开一次训练页打十个请求」 */
const BACKFILL_MAX_DATES = 6;

/**
 * 本会话补过了没有。
 *
 * 放在**模块**级而不是页面级:训练页离开再回来会重建页面,页面级的标记会跟着重置,
 * 于是每次切回训练 tab 都重跑一遍。这个开关的代价只是一次冷启动补一次 ——
 * 真正要防的是「用户在这一页反复横跳,每跳一下打六个请求」。
 */
let backfilledThisSession = false;

/**
 * 把**以前练过、但账上还没有**的那些训练补进热量引擎。
 *
 * ## 为什么非有这一步不可
 * `syncWorkoutActivity` 是挂在「练完 / 补录 / 改时长」那几个动作上的 —— 它只对**从今往后**
 * 的日志生效。而这个功能上线之前,用户已经练了几十次(日志好好躺在本地),
 * 那些日子在首页永远显示「消耗 = 基础代谢 + 日常活动」,一点训练的份都没有。
 * 用户看到的是一句「那我的训练消耗呢?」—— 而问题不在他,在我们只补了未来。
 *
 * ## 怎么补
 * 按日期把日志分组（只看最近 `BACKFILL_DAYS` 天、最多翻 `BACKFILL_MAX_DATES` 个日期),
 * **每个日期只拉一次**当天的活动列表,把 `externalId` 对不上的那些建出来。
 * 已经写过的日期不会再产生任何写请求 —— 补完一轮之后,这个函数每天的净开销
 * 就是几次 GET。
 *
 * 整个过程静默:拉不到列表的那天跳过,不抛、不打断打开训练页这件事。
 * 返回这次建了几条(给测试和排查用)。
 *
 * ## 谁调它
 * 训练分包里几个「一进来就会 loadLogs()」的页面都调(计划页 / 训练记录页 / 统计页)——
 * 主包进不了分包,没有那个「一打开 App 就补一次」的全局钩子;能做的只有
 * **谁先开谁补**,靠上面那个会话级开关保证只真跑一次。用户只要点进训练相关任一页,
 * 首页那个「消耗」当天就会多出训练那一笔。
 */
export async function backfillWorkoutEnergy(
  logs: WorkoutLog[],
  opts: { days?: number; maxDates?: number; force?: boolean } = {}
): Promise<number> {
  if (backfilledThisSession && !opts.force) return 0;
  backfilledThisSession = true;

  const days = opts.days ?? BACKFILL_DAYS;
  const maxDates = opts.maxDates ?? BACKFILL_MAX_DATES;
  // 「最近 N 天」按**最新那条日志**算,而不是按今天 —— 一个两周没练的人打开训练页时,
  // 他要补的恰恰是两周前那几次,卡在「今天往前 14 天」会把它们全漏掉
  const newest = logs.reduce((m, l) => (l.date > m ? l.date : m), '');
  if (!newest) return 0;
  const floor = addDays(newest, -days);

  const byDate = new Map<string, WorkoutLog[]>();
  for (const l of logs) {
    if (l.date < floor || l.date > newest) continue;
    byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  }

  const kg = await bodyWeightKg();
  let created = 0;
  // 从近到远:先补最近的那几次 —— 用户在首页看到的就是这几天,先让它们对上
  const dates = [...byDate.keys()].sort().reverse().slice(0, maxDates);

  for (const date of dates) {
    try {
      const rows = await listAllActivities(date);
      const have = new Set(rows.map((a) => a.externalId).filter(Boolean) as string[]);
      for (const log of byDate.get(date) as WorkoutLog[]) {
        if (have.has(log.id)) continue;
        const calories = workoutKcal(log.durationSec, kg ?? FALLBACK_WEIGHT_KG);
        if (calories == null) continue;
        await createRow(log, Math.max(1, Math.round(log.durationSec / 60)), calories);
        created++;
      }
    } catch {
      // 这一天拉不到就跳过:补写是「顺手把旧账补上」,不该让人打不开训练页
    }
  }
  return created;
}
