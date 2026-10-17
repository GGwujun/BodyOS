/**
 * 计时组 —— 有些动作的目标不是「做几次」,是「撑多久」。
 *
 * 平板支撑、L 支撑、靠墙静蹲、农夫行走、倒立 —— 这些动作没有次数可言。
 * 在那之前用户能做的只有两件都不对的:按感觉编一个次数(于是「撑了 60 秒」变成
 * 「15 次」,而且这个数字会进容量、进曲线、进 1RM 估算),或者干脆不记。
 * 所以这里让它们按**秒**记。
 *
 * ## 口径(整条链路只有这一个)
 *
 * **次数型的动作照旧走 `reps`;计时型的动作走 `sec`,而且 `reps` 恒为 0。**
 *
 * 为什么不把秒数塞进 `reps`(想省一个字段):那恰好是 `sided.ts` **可以**合并、
 * 而这里**不可以**的那个区别。单侧动作折的是同一个量(次数)的两种数法,
 * 所以 `reps × 重量` 依旧成立,合并之后一处都不用改。而秒和次数**不是同一个量**:
 * 一旦混进 `reps`,容量 `reps × 重量` 就开始把秒当成次数乘 —— 那个错不会报错,
 * 只会让容量、曲线、1RM 一起悄悄算歪,而这几个数恰好是用户唯一会盯着看的东西。
 *
 * 计划那边用的是 `PlannedExercise.holdSec`(处方,不参与任何运算,所以能安全地
 * 用「有这个字段 = 计时型」来表达);日志那边用的是每组自己的 `sec`,而 `reps` 归 0。
 * 两处形状不同是**故意的**:计划是处方,日志是数据,只有数据那边有算术。
 *
 * ## 自动判定:靠动作库里的「静力」分类
 *
 * 动作库 1,324 条里 `category === 'isometric'`(静力)有 24 条,人工标过,且干净 ——
 * 「俯卧撑转侧平板支撑」「侧平板支撑髋内收」这类**名字像但是移动**的动作没有落进去
 * (它们在库里就是 calisthenics),落到里面的是负重平板支撑、平板支撑转体、
 * 力量点平板支撑、地面 L 支撑、前后水平、人体旗帜、帕洛夫推举、侧桥这些**真的只能撑**的。
 *
 * 有三件事得说清楚:
 *   · **`force === 'static'` 不能用** —— 那 18 条里 16 条是拉伸/活动度(它是「等长/拉伸」
 *     的意思,不是「按时间练」的意思),剩下 2 条是 onerm 里那条 `lower back curl` 和
 *     `one arm against wall`。按它筛出来的是拉伸课,不是计时课。
 *   · **动作库里没有原版「平板支撑」和「靠墙静蹲」** —— 有的是它们的变式(负重平板支撑、
 *     侧桥、靠墙坐姿……)。所以这两条路留给用户自建动作(见 custom.ts 的 `timed` 开关),
 *     不是漏了。
 *   · 静力分类里也有**误标的一条**:`march sit (wall)`(靠墙坐姿踏步)是在踏步,不是撑住 ——
 *     见下面的 `NOT_TIMED`。
 *
 * 顺带:搬运类**本来就只有时间这一个量**,但它们挂在「力量」下,所以得按名字收:
 * `farmers walk`(农夫行走)与 `dumbbell single arm overhead carry`(哑铃单臂过头行走)。
 */
import { EXERCISES } from '../data/exercises';
import { findCustom } from './custom';
import { sideRangeText } from './sided';
import type { TrainingPlan } from './types';

/**
 * 名字里带这些就是计时型的(在英文原名上判,和 `sided.ts` 同一个道理:
 * 中文名未必翻译得出来,英文名一定有)。
 *   · carry       —— 过头行走这类搬运
 *   · farmers? walk —— 农夫行走
 *   · dead hang   —— 单杠悬挂(**这库里没有**,留着是给以后补录用的)
 *
 * 为什么 `hang` 不能裸着写:库里有 16 条「悬垂举腿」(`hanging leg raise` 那一族),
 * 那些是**按次数**练的,裸写 `hang` 会把它们一起卷进来。所以只认 `dead hang` 这个整体。
 */
const TIMED_RE = /carry|farmers?[ -]?walk|dead[ -]?hang/;

/**
 * 静力分类里的**误标**:这一条是在踏步(`march`),不是撑住 —— 计时它没有意义,
 * 用户会看到一个「目标 45 秒的马步踏步」。只列确实在库里的,别写成一张愿望清单。
 */
const NOT_TIMED = new Set(['0624']); // march sit (wall) 靠墙坐姿踏步

let cache: Set<string> | null = null;

/** 计时型动作 id 集合 —— 全库扫一遍,只做一次 */
function timedIds(): Set<string> {
  if (cache) return cache;
  const ids = new Set<string>();
  for (const e of EXERCISES) {
    if (NOT_TIMED.has(e.id)) continue;
    if (e.category === 'isometric' || TIMED_RE.test((e.name || '').toLowerCase())) ids.add(e.id);
  }
  cache = ids;
  return cache;
}

/** 这套判定一共认了多少条(冒烟用例盯它:库变了这个数会动,判定写歪了也会动) */
export function timedCount(): number {
  return timedIds().size;
}

/**
 * 这个动作按**时长**练吗。
 * 自定义动作**先问它自己** —— 那套判据跑在动作库的分类和英文名上,
 * 而用户起的名字(「我的靠墙静蹲」)根本不在射程里;创建时勾的那个开关才是事实。
 */
export function isTimed(exerciseId: string): boolean {
  const c = findCustom(exerciseId);
  if (c) return c.timed;
  return timedIds().has(exerciseId);
}

/**
 * 这次训练里这个动作是不是计时型 —— 计划里还有它就以**计划**为准:
 * 用户手动关掉过计时开关的动作不该被动作库的分类又翻回来(和 `sidedInPlan` 同一条规矩)。
 */
export function timedInPlan(plan: TrainingPlan | null | undefined, exerciseId: string): boolean {
  const it = plan?.days.flatMap((d) => d.items).find((x) => x.exerciseId === exerciseId);
  if (it) return Boolean(it.holdSec);
  return isTimed(exerciseId);
}

/** 起手目标:第一次做这个动作时的秒数(计划生成器与手动加动作都用它) */
export const HOLD_DEFAULT_SEC = 30;
/** 一次计时最多记多久 —— 超过了多半是忘了按停,记下来反而污染「最长保持」 */
export const HOLD_MAX_SEC = 15 * 60;
/** 手动加减秒数的步长(训练页那两个 −/+ 按钮) */
export const HOLD_STEP_SEC = 5;
/** 渐进步长:撑到上限 → 下次目标 +5 秒 */
export const HOLD_PROGRESS_STEP_SEC = 5;
/** 连续两次没撑到 → 目标回退 5 秒(和次数型「回退 2 次」同一条安全网) */
export const HOLD_PROGRESS_BACK_SEC = 5;
/** 目标秒数封顶 —— 到顶之后不再加时间,改为推荐更难的变式(和次数型的 25 次封顶同一个道理) */
export const HOLD_PROGRESS_CAP_SEC = 120;
/**
 * 计划里给计时动作排的起手秒数区间(生成器用)。
 *   · long  —— 核心与支撑类(平板支撑、L 支撑):一组撑几十秒是常态
 *   · short —— 搬运与抗旋转类(农夫行走、帕洛夫推举):一组就几十秒,再长是另一个动作
 * 这只是一个**起点**,用户练两次就会自己调 —— 和次数型的起手重量同一种性质。
 */
export const HOLD_RANGE: Record<'short' | 'long', { min: number; max: number }> = {
  short: { min: 20, max: 45 },
  long: { min: 45, max: 90 }
};

/** 秒数说人话:90 → 「1 分 30 秒」;整分退回「2 分」 */
export function holdText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} 分 ${rest} 秒` : `${m} 分`;
}

/** 处方那一行怎么说:「30-45 秒」 */
export function holdRangeText(minSec: number, maxSec: number): string {
  return minSec === maxSec ? holdText(maxSec) : `${minSec}-${maxSec} 秒`;
}

/** 一个计划项里够用来报处方的那几格(不依赖 `PlannedExercise` 全体) */
export interface SchemeLike {
  sets: number;
  repsMin: number;
  repsMax: number;
  holdSec?: { min: number; max: number };
  sided?: boolean;
}

/**
 * 一个计划项的组次处方怎么说:「3 组 × 8-12 次(每侧 4-6)」/「3 组 × 保持 30-45 秒」。
 *
 * 这一句以前在四个地方各拼一遍(计划页、计划编辑、计划分享、导出文本),计时项进来以后
 * 那四处都会显示「3 组 × 0 次」—— 那个 0 是计时项留在 `repsMin/repsMax` 里的占位值
 * (见 engine/generator.ts 的 `holdScheme`),不是处方;四处里只要漏改一处,
 * 用户看到的是一份让他「撑 0 次」的计划。所以收成一个函数,四处都调它。
 */
export function schemeText(it: SchemeLike): string {
  const scheme = it.holdSec
    ? `保持 ${holdRangeText(it.holdSec.min, it.holdSec.max)}`
    : sideRangeText(it.repsMin, it.repsMax, it.sided);
  return `${it.sets} 组 × ${scheme}`;
}

/** 达标判断用的上限 —— 撑到区间上沿就算达标(和次数型比 `repsMax` 同一个口径) */
export function holdTargetSec(holdSec: { min: number; max: number } | undefined): number {
  return holdSec ? Math.max(1, holdSec.max) : HOLD_DEFAULT_SEC;
}

/**
 * 这一组最终记多少秒 —— 把「超时继续计时」收在一处。
 *
 * `HOLD_MAX_SEC` 是**忘了按停**的兜底,不是训练建议:一个人真撑了 20 分钟平板,
 * 那多半是手机放在旁边没管。截断而不是丢弃 —— 丢弃会让用户看到「我刚才那组没了」。
 */
export function clampHoldSec(sec: number): number {
  if (!Number.isFinite(sec)) return 0;
  return Math.max(0, Math.min(HOLD_MAX_SEC, Math.round(sec)));
}

/** 计时组的重量怎么说 —— 有配重就说,没有就说自重(农夫行走是有配重的) */
export function holdLoadText(weightKg: number | null): string {
  return weightKg == null ? '自重' : `${weightKg}kg`;
}

/**
 * 若干组加起来撑了多久(秒)。次数型的组没有 `sec`,贡献 0 —— 所以这个数就是
 * 「这些组里的计时部分一共多久」,不用先筛一遍「哪些组是计时型」。
 * 各处的「本次保持总时长」都走它,不各写一份 reduce。
 */
export function holdSecOfSets(sets: { sec?: number }[]): number {
  return sets.reduce((a, s) => a + Math.max(0, Math.round(s.sec ?? 0)), 0);
}
