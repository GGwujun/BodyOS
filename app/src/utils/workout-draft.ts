/**
 * 训练中这一场 —— 还没结束的那次训练,存在本机的那一份。
 *
 * 为什么要它:训练页的组数一直**只活在页面内存里**(`rows`),而小程序会被系统回收、
 * 用户也可能从小程序列表里把整个小程序划掉。这两条路不经过任何页面回调 ——
 * 整场训练无声消失。这是全站唯一一处「他明明练了,账上什么都没有」的地方:
 * 离开守卫拦的是 `switchTab` 和原生返回键(主动离开那一类),拦不住系统回收。
 *
 * 为什么落在主包 utils 而不是训练分包:这份数据要**两个地方**读得到 ——
 * 训练页自己(接着练)和首页(「上次那场没练完,继续?」)。分包可以 import 主包,
 * 反过来不行,所以它只能在主包(和 training-digest 同一个路子,理由也一样)。
 *
 * 什么时候清:训练结束、组数落进日志之后(唯一「这些数据有归宿了」的时刻)。
 * **不因为日期翻篇就清**:昨晚 23:50 练到一半、今天 00:10 再打开,那些组还是他的数据。
 * 一份没有归宿的草稿宁可多留几天等人来处理,也不该悄悄删掉 —— 删掉就是要他重练。
 *
 * 存的是**渲染一个训练页所需的全部**:有了它,不用管计划是不是被改过(训练中本来
 * 就允许换动作/加练/删行,那些改动只在这一场里),页面原样恢复。
 */
import Taro from '@tarojs/taro';

const KEY = 'bodyos.workout-draft';

/** 一组 — 字段与训练页的 SetRow 一一对应(那边改动时这里要一起改,见 pickRow) */
export interface DraftSet {
  reps: number;
  weightKg: number | null;
  done: boolean;
  rir: number | null;
  /** 组型标签(递减/力竭/降重/金字塔档位),空串或没有 = 普通组 */
  tag?: string;
  note?: string;
  /** 计时组的实际秒数(次数型没有这个字段) */
  sec?: number;
  /**
   * 这一组是训练中**临时加的**(点了「＋ 加一组」),不是计划里本来就有的。
   *
   * 为什么要记这一笔:计划里写了三组、今天只做了两组,少做的那组是信息(那个重量的刺激
   * 没做完),所以不留「删一组」的按钮 —— 留着不打勾就行。但「＋ 加一组」按错一下
   * 多出来的那一组是另一回事:它不是计划的一部分,却会在底栏和「结束训练」的确认框里
   * 一直说「还有 1 组没完成」。这个标记就是用来把这两种组分清的 —— 只有加出来的能撤。
   */
  added?: true;
}
export interface DraftRow {
  exerciseId: string;
  nameZh: string;
  patternId: string;
  restSec: number;
  weightStepKg: number;
  isBodyweight: boolean;
  sided?: boolean;
  holdSec?: { min: number; max: number };
  setType: string;
  superset?: string;
  /**
   * 这个动作本次不计入进阶(训练页动作卡片上的开关)。
   * 和 `DraftSet.added` 同一个理由要留下:这一格丢了,恢复之后用户得重新想一遍
   * 「刚才是哪个动作不算来着」—— 而且他多半想不起来,那一场就白标了。
   */
  noProg?: boolean;
  /**
   * 这个动作安排几组热身(0 = 不热身;缺省 = 引擎自动推,最多 3 组)。
   * 和组数/重量一样是**处方的一部分**,恢复草稿时得跟着回来 ——
   * 丢了它,昨天特意设成「不热身」的动作今天会凭空冒出三组引导。
   */
  warmupSets?: number;
  /** 这一天的安排备注(「今天用窄握」)。和动作常驻备注是两件事,别混 */
  note?: string;
  sets: DraftSet[];
}

export interface WorkoutDraft {
  /** 开始那一天('YYYY-MM-DD')—— 首页那句「10月13日那场」用它,不影响能不能恢复 */
  date: string;
  /** 这一场归属的训练日;合并训练是合成 key(`推+拉`) */
  dayKey: string;
  /** 合并训练里的每一套。单套/老草稿没有这个字段,按 dayKey 拆 */
  dayKeys?: string[];
  dayTitle: string;
  /** 开练那一刻的墙钟(恢复时不用它,用不了那么远 —— 见 sec) */
  startedAt: number;
  /** 最后一次写入的时刻 */
  at: number;
  /**
   * 截止最后一次写入,这一场已经走了多少秒。
   *
   * 恢复时拿 `Date.now() - sec * 1000` 反推一个起点 —— **不能拿 startedAt**:
   * 小程序被回收后隔了一夜再打开,那场训练会变成「已经练了 14 小时」,
   * 而这个数字是要进日志、进「本周练了多久」的。冻结在最后一次写入那一刻,
   * 等于「被打断的那段不算他的成绩」;人真觉得少算了,汇总页本来就能手改时长。
   */
  sec: number;
  rows: DraftRow[];
  /** 热身打勾的 key(`${行号}-${热身序号}`) */
  warmDone: string[];
  showEffort: boolean;
  sessionNote: string;
  noProg: boolean;
  weighed: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** 2020-01-01 —— 比这还早的时间戳只可能是坏数据(设备时钟错乱/手改) */
const EPOCH_FLOOR = 1577836800000;

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  return n == null ? null : Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
/** 可以缺,但一旦有就必须是个正整数 */
const optInt = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = num(v, lo, hi);
  return n == null ? undefined : Math.round(n);
};

/**
 * 脏数据一律拒收 —— 这是**唯一**一条能把训练页整页打不开的路子:
 * 微信说 `/api/v1` 没了只是报个错,一份形状不对的草稿会让 `rows[ri].sets[si]`
 * 在渲染里直接抛。所以恢复之前先整份过一遍,任何一处不对就当**没有这份草稿**
 * (宁可让人重来,也不能让人打不开)。
 */
function sane(raw: unknown): WorkoutDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as WorkoutDraft;
  if (!ISO.test(String(d.date)) || !str(d.dayKey)) return null;
  if (!Array.isArray(d.rows)) return null;
  const rows: DraftRow[] = [];
  for (const r of d.rows) {
    if (!r || typeof r !== 'object') return null;
    const row = r as DraftRow;
    const exerciseId = str(row.exerciseId);
    if (!exerciseId || !Array.isArray(row.sets)) return null;
    const sets: DraftSet[] = [];
    for (const s of row.sets) {
      if (!s || typeof s !== 'object') return null;
      const set = s as DraftSet;
      sets.push({
        reps: num(set.reps, 0, 999) ?? 0,
        weightKg: num(set.weightKg, 0, 1000),
        done: set.done === true,
        rir: num(set.rir, 0, 10),
        ...(str(set.tag, 20) ? { tag: str(set.tag, 20) } : {}),
        ...(str(set.note) ? { note: str(set.note) } : {}),
        ...(optInt(set.sec, 0, 86400) != null ? { sec: optInt(set.sec, 0, 86400) } : {}),
        // 临时加的那一组标记要活着:它丢了,恢复之后那一组就撤不掉了
        ...(set.added === true ? { added: true as const } : {})
      });
    }
    if (!sets.length) return null;
    const hs = row.holdSec;
    /** 步长 0 和「没给」是同一件事 —— 与计划里那句 `it.weightStepKg || 2.5` 一个意思 */
    const stepKg = num(row.weightStepKg, 0, 50) ?? 0;
    rows.push({
      exerciseId,
      nameZh: str(row.nameZh, 60) || exerciseId,
      patternId: str(row.patternId, 60),
      restSec: num(row.restSec, 0, 3600) ?? 0,
      weightStepKg: stepKg >= 0.25 ? stepKg : 2.5,
      isBodyweight: row.isBodyweight !== false,
      ...(row.sided === true ? { sided: true } : {}),
      ...(hs && num(hs.min, 1, 3600) != null && num(hs.max, 1, 3600) != null
        ? { holdSec: { min: num(hs.min, 1, 3600) as number, max: num(hs.max, 1, 3600) as number } }
        : {}),
      setType: str(row.setType, 20) || 'normal',
      ...(str(row.superset, 40) ? { superset: str(row.superset, 40) } : {}),
      ...(row.noProg === true ? { noProg: true } : {}),
      sets
    });
  }
  if (!rows.length) return null;
  const startedAt = num(d.startedAt, EPOCH_FLOOR, Date.now() + 86400000);
  const at = num(d.at, EPOCH_FLOOR, Date.now() + 86400000);
  if (startedAt == null || at == null) return null;
  const warmDone = Array.isArray(d.warmDone)
    ? d.warmDone.filter((k) => typeof k === 'string' && /^\d+-\d+$/.test(k)).slice(0, 200)
    : [];
  return {
    date: String(d.date),
    dayKey: str(d.dayKey),
    dayTitle: str(d.dayTitle, 60),
    startedAt,
    at,
    sec: num(d.sec, 0, 86400) ?? 0,
    rows,
    warmDone,
    showEffort: d.showEffort === true,
    sessionNote: str(d.sessionNote, 500),
    noProg: d.noProg === true,
    weighed: d.weighed === true
  };
}

function readRaw(): unknown {
  try {
    return Taro.getStorageSync(KEY);
  } catch {
    return null;
  }
}

/**
 * 读回来。**一组都没勾的那份不算数**(还没开始练,和没有一样)——
 * 首页不该为「他点进去看了一眼就退出来」摆一个「继续」。
 */
export function loadDraft(): WorkoutDraft | null {
  const d = sane(readRaw());
  if (!d) return null;
  const anyDone = d.rows.some((r) => r.sets.some((s) => s.done));
  return anyDone ? d : null;
}

/** 上次写下去的那一份原文 —— 每次点击都调这个,内容没变就不重复写 */
let lastWritten: string | null = null;

/**
 * 存一份(每次改动都调,内部按内容去重)。
 *
 * `sec` 在这里**现算**而不是让页面传:`elapsed` 是每秒重渲染的那个 state,
 * 把它塞进依赖数组等于每秒写一次存储。页面只要给**起点**,这儿自己减。
 */
export function saveDraft(d: Omit<WorkoutDraft, 'sec' | 'at'> & { startedAt: number }): void {
  const now = Date.now();
  const payload: WorkoutDraft = {
    ...d,
    at: now,
    sec: Math.min(86400, Math.max(0, Math.floor((now - d.startedAt) / 1000)))
  };
  let stamp: string;
  try {
    // 去重看**内容 + 已经走了几秒**,不看 at —— at 每一次调用都不同,把它算进去等于从不去重。
    // 秒数留在里面是为了下面那一趟:切后台时内容一个字没改,但时钟自己走了几分钟,
    // 那一趟必须写得进去(否则恢复出来的时长永远停在最后一次勾组的时刻)。
    stamp = JSON.stringify({ ...payload, at: 0 });
  } catch {
    return; // 环引用之类:写不进去也不该把训练页弄崩
  }
  if (stamp === lastWritten) return;
  try {
    Taro.setStorageSync(KEY, payload);
    lastWritten = stamp;
  } catch {
    // 存储满/被禁 —— 静默:这一路本来就是兜底,不该反过来打断正在练的人
  }
}

/** 训练进了日志(或者用户明确放弃)—— 这一份的归宿到了 */
export function clearDraft(): void {
  lastWritten = null;
  try {
    Taro.removeStorageSync(KEY);
  } catch {
    // 同上
  }
}

/**
 * 这份草稿是不是「今天这一场已经收尾了」的残留?
 *
 * 旧版本在练完关掉汇总时会先把 `summary` 置空、再退出页面 —— 那一帧 rows 还全勾着,
 * 草稿写入的 effect 就把刚 `clearDraft()` 掉的内容原样写了回来。首页于是同时读到
 * 「今日快照:练完了」和「草稿:还没练完」,两张卡互相打脸(现在训练页用
 * `finishedRef` 堵住了写入,这里负责把已经留在本机的脏草稿认出来)。
 *
 * 条件刻意收得很窄:同一天、同一套(dayKey 对得上)、**而且所有组都勾完了**。
 * 另一套的草稿、或者真正练了一半的草稿,一律不动 —— 宁可让它留在首页,
 * 也不能把还没进日志的组误删。
 */
export function draftAlreadyDone(
  d: WorkoutDraft,
  digest: { date: string; state: string; dayKey: string; title: string } | null
): boolean {
  if (!digest || digest.state !== 'done' || digest.date !== d.date) return false;
  const complete = d.rows.length > 0 && d.rows.every((r) => r.sets.every((s) => s.done));
  if (!complete) return false;
  const dKeys = d.dayKeys?.length ? d.dayKeys : [d.dayKey];
  const gKeys = digest.dayKey ? digest.dayKey.split('+') : [];
  if (gKeys.length && gKeys.some((k) => dKeys.includes(k))) return true;
  // 快照写坏一半(dayKey 空)时退回标题 —— 同一天 + 同一套名 + 全勾完,足够确认是同一场
  return !digest.dayKey && !!digest.title && digest.title === d.dayTitle;
}

/** 首页那张「继续」卡要的全部:还差多少组、哪一天、练的是哪一套 */
export function draftBrief(d: WorkoutDraft | null): { sets: number; total: number; date: string; title: string } | null {
  if (!d) return null;
  const total = d.rows.reduce((a, r) => a + r.sets.length, 0);
  const sets = d.rows.reduce((a, r) => a + r.sets.filter((s) => s.done).length, 0);
  if (!sets) return null;
  return { sets, total, date: d.date, title: d.dayTitle };
}
