/**
 * 「今天练什么」的小抄 —— 训练分包写给主包看的一张快照。
 *
 * **为什么要有它**:首页和 TabBar 在主包,而「今天该练哪天」的算法在训练分包
 * (`pkg-exercise/engine/` 的 schedule + dayassign + daynote,计划和日志也都在那儿)。
 * 小程序的规则是主包**不能**引用分包里的文件 —— 反过来引,webpack 会把 engine 整坨
 * 搬进主包,那 1.6MB 的分包也就白分了。只剩一条路:算得出答案的那半边
 * (plan-view / workout)每次算完**顺手写一张小抄**,主包只读。
 * 这和 `sync-marks.ts` 倒过来的理由一样 —— 谁在两个世界之间,谁就住在主包。
 *
 * **为什么按天作废**:小抄上的每个字都是「今天」的函数 —— 轮转的下一个训练日、
 * 今天请没请假、今天练没练。跨过午夜,昨天那张说的全是错话,而只有分包算得出新的。
 * 所以读的时候对不上日期就当作**没有**(退回 null),让首页说一句不会错的话
 * (「力量训练 · 看今天的计划」),等用户点进计划页再补上。
 *
 * 这里**只存派生出来的字**:计划、日志、渐进、请假条一份都不在这儿,丢了就丢了 ——
 * 下次算完会再写一遍。
 */
import Taro from '@tarojs/taro';
import { addDays, mondayOf, todayStr } from './date';

const KEY = 'bodyos.training.today';

/** 今天训练这一摊的现状 */
export type TrainingState =
  /** 还没排计划 —— 快照里其它字段都是空的 */
  | 'none'
  /** 有计划、今天还没练 */
  | 'todo'
  /** 今天练过了 */
  | 'done'
  /** 计划把今天排成休息日(固定周的空格)—— 不是请假,也没有欠账 */
  | 'rest'
  /** 今天在请假 */
  | 'off';

/**
 * 周条上一天能有的记号。**只有「有说头」的几天才记**:练过 / 请过假 / 改练过。
 * 没有记号的那天就是一个普通日子 —— 轮转制算不出「下周三该练什么」,
 * 所以这里**不编**未来该练哪天(那件事由 `state` 和卡片上那句话去说)。
 */
export type WeekState = 'done' | 'off' | 'moved';

export interface WeekDot {
  /** YYYY-MM-DD */
  d: string;
  s: WeekState;
}

export interface TrainingDigest {
  /** 写这张小抄时的**用户本地日期**(不是 UTC);读的时候对不上就是过期 */
  date: string;
  state: TrainingState;
  /** 今天该练/练过/请假的那个训练日 key;没计划时是空串 */
  dayKey: string;
  title: string;
  focus: string;
  estMin: number;
  /** 今天被改练成了别的 —— 只对 todo 有意义 */
  reassigned: boolean;
  /**
   * 今天这一套里有什么(只有动作名)。给**训练 tab**那一页列的 —— 首页那张卡只有一行字,
   * 摆不下这个,而「今天要练的六个动作叫什么」恰恰是决定要不要现在开练的那点信息。
   * 只存名字:重量/组次是开练以后才要照着做的东西,而且它们会随渐进变,
   * 抄一份到主包来就多了一处会过期的数据。
   */
  items: string[];
  /**
   * `date` 那一周(周一到周日)里**有说头**的那几天。没有约定就没有那天的条目 ——
   * 「今天该练」由上面的 `state` 一个人说,不在这份里重复一遍。
   * 锚点是推出来的(`date` 所在周的周一),不单独存:存两个日期就一定会有一天对不上。
   */
  week: WeekDot[];
}

/**
 * 写入时不用带日期(默认就是今天),要提前写别的日期才传;`week` 不传表示「手上没有这一份」。
 * `items` 比 `week` 更窄:只有计划页算得出今天的动作表,练完/补录那两条路手上没有它 ——
 * 不传就继承同一份快照里的(见 saveTrainingDigest)。
 */
export type TrainingSnapshot =
  Omit<TrainingDigest, 'date' | 'week' | 'items'> & { date?: string; week?: WeekDot[]; items?: string[] };

const STATES: TrainingState[] = ['none', 'todo', 'done', 'rest', 'off'];
const WEEK_STATES: WeekState[] = ['done', 'off', 'moved'];

/**
 * 脏数据一律降级成 null —— 这张小抄只喂给一张卡片,
 * 为它写一整套字段校验不值得,但**不能**让它把首页搞崩。
 */
function sane(v: unknown): TrainingDigest | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>;
  // 日期必须长得像个日期:下面的周条要按它推周一,给个 'x' 进来会推出一个 NaN 的周
  if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return null;
  if (!STATES.includes(d.state as TrainingState)) return null;
  return {
    date: d.date,
    state: d.state as TrainingState,
    dayKey: typeof d.dayKey === 'string' ? d.dayKey : '',
    title: typeof d.title === 'string' ? d.title : '',
    focus: typeof d.focus === 'string' ? d.focus : '',
    // 时长只用来写一行小字,坏了就当 0 —— 别让一个 NaN 把「约 NaN 分钟」印在卡上
    estMin: typeof d.estMin === 'number' && Number.isFinite(d.estMin) && d.estMin > 0 ? d.estMin : 0,
    reassigned: d.reassigned === true,
    items: itemsOf(d.items),
    // 周条:只认落在 `date` 那一周里、状态叫得出名字的日期。别的(别的周的、日期写坏的、
    // 状态没见过的)一律不画 —— 在别人本周的那一排格子上多画一个点,比少画更糟
    week: weekOf(d.date, d.week)
  };
}

/**
 * 动作名那一串:只留认得出是名字的。
 * 上限 30 条 × 24 字 —— 这不是「够不够」,是**这一页最多也就列得下这么多**,
 * 而快照必须有个头:它是写进 storage 的一份,坏数据进来不能变成一个无限大的数组。
 */
function itemsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim().slice(0, 24);
    if (s) out.push(s);
    if (out.length >= 30) break;
  }
  return out;
}

/** 把一坨来路不明的「周条」收成这一周以内、状态认得出的几天 */
function weekOf(date: string, raw: unknown): WeekDot[] {
  if (!Array.isArray(raw)) return [];
  const mon = mondayOf(date);
  const sun = addDays(mon, 6);
  const out: WeekDot[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const dot = v as WeekDot;
    if (typeof dot.d !== 'string' || dot.d < mon || dot.d > sun) continue;
    if (!WEEK_STATES.includes(dot.s)) continue;
    if (out.some((x) => x.d === dot.d)) continue;
    out.push({ d: dot.d, s: dot.s });
  }
  return out.slice(0, 7);
}

/**
 * 读今天这张小抄。**不是今天的、没写过的、写的不是东西的,一律 null** ——
 * 调用方只需要区分「知道今天这摊长什么样」和「不知道」两种,不必自己比日期。
 */
export function loadTrainingDigest(today = todayStr()): TrainingDigest | null {
  let raw: unknown;
  try {
    raw = Taro.getStorageSync(KEY);
  } catch {
    return null;
  }
  const d = sane(raw);
  return d && d.date === today ? d : null;
}

/** 读原始记录(不过期检查)—— 只给 save 看上一份是什么样 */
function readRaw(): unknown {
  try {
    return Taro.getStorageSync(KEY);
  } catch {
    return null;
  }
}

/**
 * 写今天这张小抄(唯一写入路径)。
 *
 * `week` 不传时**继承上一份**:周条那份是计划页算的,而「刚练完」「刚补录」这两条路径
 * 手上没有它(也不该为了一条点把请假表和改练表都读一遍)。不继承的话,练完一回来
 * 周条上的点全没了 —— 恰恰是最想看的时候。
 *
 * 只继承**同一周**的:跨过周日午夜之后那一排格子已经换了一周,旧的点落在别的日期上,
 * 留着也是被 `weekOf` 按新的一周筛掉。
 */
export function saveTrainingDigest(d: TrainingSnapshot): void {
  const date = d.date ?? todayStr();
  const clean = sane({ ...d, date });
  if (!clean) return;
  const old = d.week && d.items ? null : sane(readRaw());
  if (!d.week && old && mondayOf(old.date) === mondayOf(date)) clean.week = old.week;
  // 动作表只在**同一天**里继承:换了一天,昨天那几个动作名就是错的话
  if (!d.items && old && old.date === date) clean.items = old.items;
  try {
    Taro.setStorageSync(KEY, clean);
  } catch {
    // 写不进去只是首页那张卡退回一句泛泛的话 —— 不该把刚练完的人卡在这里
  }
}

/**
 * 周条要画的所有记号,按日期取。**今天那格不在这儿** —— 它用 `state`(见首页),
 * 那份是带着「改练」「请假」全部上下文的判断,比这份只记了个事实的准。
 */
export function weekDotMap(d: TrainingDigest | null): Record<string, WeekState> {
  const out: Record<string, WeekState> = {};
  for (const dot of d?.week ?? []) out[dot.d] = dot.s;
  return out;
}

/* ============ 长什么样 ============ */

/**
 * 四个状态各自的脸色。**放在这儿而不是各页面里**:同一个状态在首页那张卡和训练 tab 上
 * 得是同一个长相(绿=该练了、灰蓝=请假),各写一份的话迟早会分叉 ——
 * 而「该练了」是绿的、「请假」是另一种说法,靠的就是这两处颜色一致。
 * 值是 CSS 类名的后缀,两边的 scss 各自接上自己的前缀。
 */
export const STATE_EMOJI: Record<TrainingState, string> = {
  none: '🗂', todo: '🏋️', done: '✅', rest: '🛌', off: '🌙'
};
export const STATE_TONE: Record<TrainingState, string> = {
  none: '', todo: ' is-due', done: ' is-done', rest: '', off: ' is-off'
};

/* ============ 话怎么说 ============ */

/** 分包里的两个落脚点。写在**这里**而不是各页面里:首页卡和 TabBar 要落在同一处 */
export const TRAINING_PLAN_URL = '/pkg-exercise/plan-view/index';
export const TRAINING_LOGS_URL = '/pkg-exercise/log-history/index';
/**
 * 直接开练 —— key 必须是日程当下建议的那一天(见 `TrainingDigest.dayKey`)。
 * 固定周一天排了两套时,dayKey 是用 `+` 拼起来的合成 key:这里拆开、走 `keys=`,
 * 训练页会把两套合并成一次训练。
 */
export function trainingStartUrl(dayKey: string): string {
  const keys = dayKey.split('+').map((k) => k.trim()).filter(Boolean);
  if (keys.length > 1) {
    return `/pkg-exercise/workout/index?keys=${keys.map(encodeURIComponent).join(',')}`;
  }
  return `/pkg-exercise/workout/index?key=${encodeURIComponent(dayKey)}`;
}

export interface DigestView {
  /** 卡片第一行 */
  title: string;
  /** 卡片第二行(小字) */
  sub: string;
  /** 那个主按钮上写什么 */
  action: string;
  /** 整张卡和主按钮都去这儿 —— 一处目标,不用先想「点哪儿算点对了」 */
  href: string;
}

/**
 * 状态 → 卡片上那几句话。首页那张卡和 TabBar 用的是**同一套措辞**:
 * 同一件事在两个地方说成两句不同的话,用户会以为是两件事。
 *
 * 注意红线:这几句是用户直接看到的文字,不许出现 AI/智能/大模型/智谱。
 */
export function digestView(d: TrainingDigest | null): DigestView {
  if (!d || d.state === 'none') {
    return d
      ? {
        title: '还没有训练计划',
        sub: '排好每周练什么,组次自动调',
        action: '去生成计划',
        href: TRAINING_PLAN_URL
      }
      : {
        title: '力量训练',
        sub: '按计划练 · 逐组渐进',
        action: '看今天的计划',
        href: TRAINING_PLAN_URL
      };
  }
  if (d.state === 'done') {
    return {
      title: d.title ? `今天练完了 · ${d.title}` : '今天练完了',
      sub: '已记下,下次接着来',
      action: '看这次练了什么',
      href: TRAINING_LOGS_URL
    };
  }
  if (d.state === 'rest') {
    return {
      title: '今天是休息日',
      // 休息不是「没有下一步」:轮转的下一套算得出来。固定周里则把用户送去日程页,
      // 那里能看到这周每一天排了什么
      sub: d.title ? `日程留白 · 下次练「${d.title}」` : '日程把今天留白 · 恢复也是训练',
      action: '看这周安排',
      href: TRAINING_PLAN_URL
    };
  }
  if (d.state === 'off') {
    return {
      title: '今天请假',
      // 请假不是「没有下一步」:下次练哪一套是算得出来的(轮转最久没练的那天),
      // 说出来比只安慰一句有用 —— 这也是 openGym 首页那句「Next session: 周三 · 腿」
      // 在我们这套轮转里的等价说法。今天被改练过就不说了:那个 dayKey 说的是
      // 「本来今天要练的」,不是下一次
      sub: d.title && !d.reassigned ? `不算欠账 · 下次练「${d.title}」` : '不算欠账,也不催你',
      action: '去计划页',
      href: TRAINING_PLAN_URL
    };
  }
  // todo:今天该练的这一天。focus / estMin 都是计划页上那一行原样搬过来的
  const detail = [d.focus, d.estMin > 0 ? `约 ${d.estMin} 分钟` : ''].filter(Boolean).join(' · ');
  return {
    title: d.title ? `今天练「${d.title}」` : '今天该练了',
    sub: (d.reassigned ? '今天改练这套 · ' : '') + (detail || '按计划练'),
    // dayKey 空 = 快照写坏了一半。这时候只能把用户送到计划页,不能瞎开一次训练
    action: d.dayKey ? '开始练' : '看今天的计划',
    href: d.dayKey ? trainingStartUrl(d.dayKey) : TRAINING_PLAN_URL
  };
}
