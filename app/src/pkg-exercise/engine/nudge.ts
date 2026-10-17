/**
 * 训练提醒 —— 「今天该练了」这句话在什么时候说、怎么说。
 *
 * 判断「该不该说」在 `schedule.ts`(节奏、欠账,请假的日子在那里被扣掉);这里只管两件事:
 *   1. **该不该闭嘴**:欠满 3 次就不再列欠账 —— 一个长假不该变成每天的唠叨。
 *      但也不装死:这时候换一句「回来就好」,不提天数、不提欠了几次,
 *      因为对一个刚断了半个月的人来说,「你欠了 5 次」只会让人继续不开 App。
 *   2. **怎么说**:三档语气(温和 / 幽默 / 打气),每档四句话,按日期轮换 ——
 *      同一句提醒连着看一周就变成噪音,而按日期选又保证了同一天反复打开
 *      看到的是同一句(不会刷一次变一句,那样很像在随机弹广告)。
 *
 * 文案里 `{0}` 是今天该练的训练日名(如「推 · 胸肩三头」)。第一次开练的人
 * (有计划、一次没练过)有自己的一组话 —— 那是最需要被推一把、也最不该被质问
 * 「你怎么没练」的时刻。
 *
 * 红线:提醒文案是**用户直接看到**的推送/卡片文字,不许出现「AI/智能/大模型/智谱」。
 */
/* 语气这套词表住在主包 `utils/reminder.ts`(设置那一层要先有权威说法),
   这里只是照着它挑文案 —— 方向是「分包 engine → 主包 utils」,别反过来引。
   `toneOf` / `NUDGE_TONES` 从这里转出去,是给分包的页面用的(它们只认这一处)。 */
import { DEFAULT_TONE, NUDGE_TONES, toneOf, type NudgeTone } from '../../utils/reminder';
import { dayDiff } from '../../utils/date';
import { NUDGE_MAX_MISSES, dayOfKey, lastTrainedBefore, missedCount } from './schedule';
import { resolveDayKey, type DayAssigns } from './dayassign';
import { isExcused, type DayNotes } from './daynote';
import type { TrainingPlan, WorkoutLog } from './types';

export { DEFAULT_TONE, NUDGE_TONES, toneOf };
export type { NudgeTone };

export const NUDGE_TONE_ZH: Record<NudgeTone, string> = {
  gentle: '温和',
  fun: '幽默',
  cheer: '打气'
};
export const NUDGE_TONE_DESC: Record<NudgeTone, string> = {
  gentle: '像朋友问一句,不催',
  fun: '拿你的肌肉开个玩笑',
  cheer: '直接推你一把'
};
/** 每档语气四句话,按日期轮换(见 lineIndex) */
export const NUDGE_COPY: Record<NudgeTone, { title: string; lines: string[] }> = {
  gentle: {
    title: '今天练不练?',
    lines: [
      '{0} 今天有空就练上,半小时就够。',
      '今天不练也没关系,明天接着来。',
      '{0} 给你留着呢,状态好了再上。',
      '歇够了就动一动,{0} 其实不长。'
    ]
  },
  fun: {
    title: '你的肌肉开了个会',
    lines: [
      '会议纪要第一条:希望今天能见你一面({0})。',
      '它们一致表示,躺着的时候真的很想念那种酸。',
      '有人提议今天就练 {0},全票通过,就等你了。',
      '它们托我转告:今天的 {0} 真的不长,别怕。'
    ]
  },
  cheer: {
    title: '今天该练了',
    lines: [
      '别等了,{0} 现在就上。',
      '{0} 不长,做完你会庆幸自己动了。',
      '状态是练出来的,不是等出来的。',
      '今天这一次,就是下次更轻松的底气。'
    ]
  }
};

/** 欠满 3 次之后的话:不列欠账,只把门打开 */
export const BACK_COPY = {
  title: '回来就好',
  lines: [
    '停了这么久,今天先动 15 分钟就算赢。',
    '别管欠了多少,今天重新开始就行。',
    '从一组开始也行,先让自己动起来。',
    '身体还记得怎么练,回来就好。'
  ]
};

/** 有计划但一次都没练过 —— 这时候不说「你该练了」,说「先开个头」 */
export const FIRST_COPY = {
  lines: [
    '计划已经排好了,今天先动一次就有底了。',
    '第一次不用做完,做一半也算数。',
    '今天开个头,后面就顺了。',
    '先从最简单的那个动作开始。'
  ]
};

/** 按日期取第几句:同一天永远同一句,连着几天不重样 */
export function lineIndex(iso: string, n: number): number {
  if (n <= 0) return 0;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  const day = Math.floor(ms / 86400000);
  return ((day % n) + n) % n;
}

/** 把 `{0}` 换成训练日名 */
export function fillCopy(line: string, dayTitle: string): string {
  return line.replace(/\{0\}/g, dayTitle);
}

export interface Nudge {
  /**
   * due  = 该练没练,可以推一条
   * back = 断太久之后的「回来就好」(不列欠账,也不该当推送发第二次)
   */
  kind: 'due' | 'back';
  tone: NudgeTone;
  title: string;
  /** 提醒正文(已经是替换好训练日名的成句) */
  line: string;
  /** 今天建议练的训练日 */
  dayKey: string;
  dayTitle: string;
  /** 欠了几次(≥1) */
  missedCount: number;
  /** 距上次训练几天;null = 一次都没练过 */
  gapDays: number | null;
  lastDate: string | null;
  /** 有计划但一次没练过 */
  firstTime: boolean;
}

/**
 * 今天该不该提一句 —— 不该就是 null(今天请了假 / 已经练过了 / 还没到该练的时候 / 没有计划)。
 * `today` 由调用方传进来(而不是内部取当前时间),这样能测。
 */
export function nudgeFor(
  input: {
    plan: TrainingPlan | null;
    logs: WorkoutLog[];
    tone?: unknown;
    notes?: DayNotes;
    /** 按天改练 —— 传了就按改的那天说("今天练腿"),没传就按轮转 */
    assigns?: DayAssigns;
  },
  today: string
): Nudge | null {
  const plan = input.plan;
  if (!plan?.days?.length) return null; // 没有计划就没有「该练哪天」可言
  // 今天标了请假就一个字都不说 —— 发烧躺床上的时候,手机不该替肌肉来催你
  if (isExcused(input.notes ?? {}, today)) return null;
  const logs = (input.logs ?? []).filter((l) => l && typeof l.date === 'string');
  const missed = missedCount(plan, logs, today, input.notes ?? {});
  if (missed < 1) return null;

  const tone = toneOf(input.tone);
  // 改练优先于日程 —— 提醒说「今天练腿」,点进去开练就必须是腿,否则就是另一个 bug。
  // 固定周的休息日返回空串:那天没有「该练哪套」,一个字都不该说。
  const key = resolveDayKey(plan, logs, input.assigns ?? {}, today);
  if (!key) return null;
  const day = dayOfKey(plan, key);
  if (!day) return null;
  const dayTitle = day.title || '训练';
  const last = lastTrainedBefore(logs, today);
  const firstTime = !last;
  const base = {
    tone,
    dayKey: day?.key ?? '',
    dayTitle,
    missedCount: missed,
    gapDays: last ? dayDiff(last, today) : null,
    lastDate: last,
    firstTime
  };

  if (missed >= NUDGE_MAX_MISSES) {
    return { kind: 'back', title: BACK_COPY.title, line: BACK_COPY.lines[lineIndex(today, BACK_COPY.lines.length)], ...base };
  }
  const copy = NUDGE_COPY[tone];
  const raw = firstTime ? FIRST_COPY.lines[lineIndex(today, FIRST_COPY.lines.length)] : copy.lines[lineIndex(today, copy.lines.length)];
  return { kind: 'due', title: copy.title, line: fillCopy(raw, dayTitle), ...base };
}

/** 「隔了 4 天」/「14 天没练了」—— 卡片上的小字,只在该提的时候提 */
export function gapText(gapDays: number | null, missed: number): string {
  if (gapDays == null) return '还没开张';
  if (gapDays <= 1) return '昨天刚练过';
  if (missed <= 1) return `距上次训练 ${gapDays} 天`;
  return `已经 ${gapDays} 天没练了`;
}
