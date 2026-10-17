/**
 * 训练的**长程**快照 —— 训练分包写给主包看的第二张小抄(第一张是 training-digest.ts)。
 *
 * **为什么还要一张**:`training-digest` 说的是「今天」,跨过午夜就作废 —— 那是给首页的。
 * 而「趋势」这个 tab 要回答的是另一个问题:**练了这么久,我有没有变**。这个问题
 * 不该只在训练分包的统计页里答得上:用户点「趋势」的时候想的就是「我的变化」,
 * 那里有体重、有步数,却一格训练都没有 —— 于是训练的成果成了整个 App 里唯一
 * 得绕三层(我的 → 健康工具箱 → 训练统计)才看得到的东西。
 *
 * **凭什么住主包**:和 digest 一样,趋势页在主包,而算这些数的 engine 在分包,
 * 主包不能引用分包(见 training-digest.ts 文件头)。所以算的那半边把**结果**写在这儿,主包只读。
 *
 * **为什么这个不作废**:它记的是攒下来的东西(练过多少天、纪录是哪天破的),
 * 昨天写的和今天写的差不了多少 —— 拿日期作废只会让趋势页每天零点空一块。
 * 数字旧一点也说得出话:卡片上写的就是「最近一次是哪天」,用户自己看得见新鲜度。
 *
 * **为什么存一串日期而不是几个现成的数**:趋势页自己有一排「7 / 30 / 90 天」的档,
 * 训练那一块得跟它一起变。存死了「近 30 天几次」的话,用户选 7 天时看到的是
 * 一个不跟着动的数 —— 同一页上两套时间口径,是这一页最不该有的东西。
 */
import Taro from '@tarojs/taro';

const KEY = 'bodyos.training.progress';

/** 快照里最多记多少天:够 90 天档看两遍对比,再长就没人翻了 */
export const MARKS_MAX = 180;

/** 一个动作的最近一次纪录 —— `kg` 是估算 1RM,不是那天举起来的重量 */
export interface LiftBest {
  name: string;
  kg: number;
  /** 这个成绩是哪天做出来的 YYYY-MM-DD */
  date: string;
}

export interface TrainingProgress {
  /** 一共练过多少次 */
  total: number;
  /** 一共练过多少天(同一天两次算一天) */
  days: number;
  /** 练过的日子,新的在前,最多 MARKS_MAX 天 —— 页面选几天就现算几天 */
  marks: string[];
  /** 最近一次练的是哪一天(推 / 拉 / 腿 ……);没练过是空串 */
  lastTitle: string;
  /** 最近破的三个纪录,新的在前 */
  lifts: LiftBest[];
}

const p2 = (x: number) => String(x).padStart(2, '0');
const str = (v: unknown, max = 40): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const isDay = (v: unknown): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

/**
 * 形状不对就整份不要(退回 null,趋势页不显示这一块)——
 * 宁可少一块,也不能让一个坏字段把趋势页整页打不开。个别字段读不懂只收窄不整份丢。
 */
function sane(raw: unknown): TrainingProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const total = num(r.total, 0, 100000);
  if (total == null) return null;
  // 先挑再看前三个:反过来做的话,一个读不懂的条目会把后面那条好的挤出前三 ——
  // 明明有三条能显示,却只出一条(「丢一个不整份丢」要丢的也正是那一个)
  const lifts = (Array.isArray(r.lifts) ? r.lifts : [])
    .map((it) => {
      const l = (it ?? {}) as Record<string, unknown>;
      const kg = num(l.kg, 0, 2000);
      const name = str(l.name);
      const date = isDay(l.date) ? str(l.date, 10) : '';
      return kg != null && name && date ? { name, kg, date } : null;
    })
    .filter((x): x is LiftBest => x != null)
    .slice(0, 3);
  return {
    total,
    days: num(r.days, 0, total) ?? 0,
    marks: (Array.isArray(r.marks) ? r.marks : []).filter(isDay).map((d) => str(d, 10)).slice(0, MARKS_MAX),
    lastTitle: str(r.lastTitle),
    lifts
  };
}

/** 读不到 / 练过 0 次 → null(趋势页据此不显示训练这一块,给它一句别的) */
export function loadTrainingProgress(): TrainingProgress | null {
  let raw: unknown;
  try {
    raw = Taro.getStorageSync(KEY);
  } catch {
    return null;
  }
  const d = sane(raw);
  return d && d.total > 0 ? d : null;
}

/** 内容没变就不写 —— 进训练区每次都会算一遍,不然是白写一遍磁盘 */
let lastWritten = '';
export function saveTrainingProgress(p: TrainingProgress): void {
  if (!p || p.total <= 0) return;
  let stamp: string;
  try {
    stamp = JSON.stringify(p);
  } catch {
    return;
  }
  if (stamp === lastWritten) return;
  try {
    Taro.setStorageSync(KEY, p);
    lastWritten = stamp;
  } catch {
    // 写不进去就下次再说 —— 这只是一张小抄,不该让训练流程报错
  }
}

/** `days` 天前那天的日期(本地)。**只用来定窗口边界**,别拿它当「多久以前」的意思 */
export function daysAgo(days: number, today: string): string {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * 最近 `days` 天里练了几天。
 *
 * **窗口正好是 `days` 天**(今天算第 1 天,也就是从 `days-1` 天前那天起)——
 * 这是趋势页那一档的口径,服务端 `GET /trends?range=N` 就是按这个切的
 * (`start = 今天 - (N-1)`)。自己另算一套的话,同一页上体重图和训练数
 * 会指着两个不同的区间,而页面上只写着「7 天」一个词。
 */
export function trainedIn(p: TrainingProgress, days: number, today: string): number {
  const from = daysAgo(Math.max(0, days - 1), today);
  return p.marks.filter((d) => d >= from && d <= today).length;
}

/**
 * 趋势页那一块要的几句话。**只在这儿写文案**:数字的口径在上面,说法在下面。
 * `days` 是页面上选的那一档 —— 训练这一块跟它一起变,不另立一套时间口径。
 */
export interface ProgressView {
  /** 「近 7 天练了 2 天」 */
  recent: string;
  /** 「比前 7 天多 1 天」/「少 1 天」/「和之前一样」/ 两段都没练时是空串 */
  delta: string;
  /** 「一共 87 次 · 52 天」 */
  total: string;
  /** 「10 月 14 日(推)」;没练过是空串 */
  last: string;
  lifts: LiftBest[];
}

export function progressView(p: TrainingProgress, days: number, today: string): ProgressView {
  const now = trainedIn(p, days, today);
  const prev = trainedIn(p, days * 2, today) - now;
  const diff = now - prev;
  // 单位是「天」不是「次」:同一天练两场不该在趋势上算成两天的成果
  return {
    recent: `近 ${days} 天练了 ${now} 天`,
    delta: now === 0 && prev === 0 ? '' : diff === 0 ? '和之前一样' : `比前 ${days} 天${diff > 0 ? '多' : '少'} ${Math.abs(diff)} 天`,
    total: `一共 ${p.total} 次 · ${p.days} 天`,
    last: p.marks[0] ? `${zhDate(p.marks[0])}${p.lastTitle ? `(${p.lastTitle})` : ''}` : '',
    lifts: p.lifts.slice(0, 3)
  };
}

function zhDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m} 月 ${d} 日`;
}
