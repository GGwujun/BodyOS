/**
 * 请假天数 —— 「这几天不练」得有个地方说得清楚。
 *
 * 为什么需要:训练提醒是靠「距上次训练几天 ÷ 你的节奏」算欠账的(见 schedule.ts)。
 * 这个算法对**计划外**的间隔是没有分辨力的:出差一周、发烧卧床、腰闪了 —— 在它眼里
 * 都只是「隔了 7 天」,于是第 3 天开始每天催你一次。用户能做的只有卸载提醒,
 * 而这件事本身是可解释、可预期的,不该被当成懒惰处理。
 *
 * 所以这里让用户把话说出来:标一天(或连着几天)是生病/受伤/出差/主动休息。
 * 标了的日子:
 *   1. 不算欠账(见 schedule.missedCount)—— 请假的 5 天不进分母;
 *   2. 今天标了就一个字都不提醒(见 nudge.nudgeFor)—— 躺在床上的时候手机不该响;
 *   3. 热力图上有个记号,而不是一片「缺勤」的空白。
 *
 * **它不改计划**:请假只影响「该不该提醒」和「欠了多少」,训练日的顺序、渐进目标
 * 一律照旧 —— 回来那天接着练下一个训练日就行,不会因为歇了几天就重排计划。
 */
import Taro from '@tarojs/taro';
import { markTouched } from '../../utils/sync-marks';
import { dayDiff } from '../../utils/date';

/** 存储 key —— 注意和 `bodyos.training.notes`(每个动作的备注)是两码事 */
export const K_DAYNOTES = 'bodyos.training.daynotes';

export type NoteKind = 'sick' | 'injured' | 'travel' | 'rest';

/** 展示顺序:越是「真的没办法」的越靠前,免得点开就看见「主动休息」 */
export const NOTE_KINDS: NoteKind[] = ['sick', 'injured', 'travel', 'rest'];

export const NOTE_KIND_ZH: Record<NoteKind, string> = {
  sick: '生病',
  injured: '受伤',
  travel: '出差 / 旅行',
  rest: '主动休息'
};

export const NOTE_KIND_DESC: Record<NoteKind, string> = {
  sick: '感冒发烧这类,养利索了再练',
  injured: '哪里疼就停哪里,别硬上',
  travel: '不在原来的地方,没器械也没时间',
  rest: '就是想歇几天 —— 这也是训练的一部分'
};

/** 补充说明的字数上限。写太长既没人看,也会把 storage 撑起来 */
export const NOTE_TEXT_MAX = 40;
/** 最多能提前记多少天(出差前一晚把接下来几天一起标了) */
export const NOTE_FUTURE_MAX = 30;
/** 能往前补记多久。再往前的事,记了也只是给热力图补花,没有意义 */
export const NOTE_PAST_MAX = 365;

export interface DayNote {
  kind: NoteKind;
  /** 补充说明,可为空串 */
  text: string;
  /** 写这条的时间(ISO) */
  at: string;
}

/** 日期 → 那天的请假条 */
export type DayNotes = Record<string, DayNote>;

export function kindOf(v: unknown): NoteKind | null {
  return NOTE_KINDS.includes(v as NoteKind) ? (v as NoteKind) : null;
}

/** 真实的日历日?—— `new Date('2026-02-30')` 会滚到 3 月,只有跟原文比对才认得出来 */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return false;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` === v;
}

/** 补充说明:去掉换行和首尾空格,超长截断 —— 脏数据不该把卡片撑破 */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  // 换行在小程序的单行 Text 里会显示成空格,干脆换掉
  return v.replace(/\s+/g, ' ').trim().slice(0, NOTE_TEXT_MAX);
}

/** 这一天能不能记请假 —— 返回不能的原因,能就返回空串 */
export function noteBlockedBy(date: string, today: string): string {
  if (!isIsoDate(date)) return '日期不对';
  const ahead = dayDiff(today, date); // 正数 = 未来
  if (ahead > NOTE_FUTURE_MAX) return `最多提前 ${NOTE_FUTURE_MAX} 天记`;
  if (ahead < -NOTE_PAST_MAX) return '这可是很久以前了';
  return '';
}

export function noteOf(notes: DayNotes, date: string): DayNote | null {
  return isIsoDate(date) && notes[date]?.kind ? notes[date] : null;
}

export function isExcused(notes: DayNotes, date: string): boolean {
  return noteOf(notes, date) !== null;
}

/**
 * (after, upto] 这半开区间里有几天是请过假的。
 *
 * 半开是有讲究的:起算点是**上次训练那天**,那天当然没请假(练都练了),
 * 而截止点含今天 —— 今天请了假,今天就不算欠。
 */
export function excusedBetween(notes: DayNotes, after: string, upto: string): number {
  if (!isIsoDate(after) || !isIsoDate(upto) || after >= upto) return 0;
  let n = 0;
  for (const [d, v] of Object.entries(notes)) {
    if (v?.kind && d > after && d <= upto) n++;
  }
  return n;
}

/** 连着请到今天是第几天(卡片上说「请假中 · 第 3 天」) */
export function excusedRunLen(notes: DayNotes, date: string): number {
  if (!isExcused(notes, date)) return 0;
  let n = 0;
  const d = new Date(`${date}T00:00:00`);
  const p = (x: number) => String(x).padStart(2, '0');
  while (n < 400) {
    const cur = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    if (!isExcused(notes, cur)) break;
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** 卡片上一句话:'生病 · 嗓子发炎' */
export function noteText(note: DayNote): string {
  return `${NOTE_KIND_ZH[note.kind]}${note.text ? ` · ${note.text}` : ''}`;
}

/**
 * 任意来源(本机 storage / 云端同步下来的)的一坨数据 → 干净的请假表。
 * 认不出来的条目**直接丢掉**,不是退回某个默认值 —— 一条读不懂的请假记录
 * 如果被当成「生病」,用户会莫名其妙地收不到提醒,比少一条记录糟得多。
 */
export function sanitizeDayNotes(raw: unknown): DayNotes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: DayNotes = {};
  for (const [date, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isIsoDate(date) || !v || typeof v !== 'object') continue;
    const kind = kindOf((v as DayNote).kind);
    if (!kind) continue;
    const at = (v as DayNote).at;
    out[date] = { kind, text: cleanText((v as DayNote).text), at: typeof at === 'string' ? at : '' };
  }
  return out;
}

/** 本机这份(读取时清洗 —— storage 里可能躺着旧版本写的脏数据) */
export function loadDayNotes(): DayNotes {
  return sanitizeDayNotes(Taro.getStorageSync(K_DAYNOTES));
}

export function saveDayNotes(notes: DayNotes): void {
  Taro.setStorageSync(K_DAYNOTES, notes);
  markTouched('daynotes', 'main');
}

/** 记一天(或改一天)的请假;日期不合法时原样返回,不写 */
export function setDayNote(notes: DayNotes, date: string, kind: NoteKind, text = '', today = ''): DayNotes {
  if (today && noteBlockedBy(date, today)) return notes;
  const next: DayNotes = { ...notes, [date]: { kind, text: cleanText(text), at: new Date().toISOString() } };
  saveDayNotes(next);
  return next;
}

export function clearDayNote(notes: DayNotes, date: string): DayNotes {
  if (!notes[date]) return notes;
  const next = { ...notes };
  delete next[date];
  saveDayNotes(next);
  return next;
}

/** 按日期从近到远列出来(只给界面用) */
export function noteList(notes: DayNotes, limit = 10): { date: string; note: DayNote }[] {
  return Object.entries(notes)
    .filter(([d, v]) => isIsoDate(d) && v?.kind)
    .map(([date, note]) => ({ date, note }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}
