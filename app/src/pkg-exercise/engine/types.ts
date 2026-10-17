/** 训练计划域类型 — 全部纯数据,可 JSON 序列化进 Taro storage */

export type Goal = 'fatloss' | 'muscle' | 'endurance';
export type Level = 'beginner' | 'intermediate';
export type EquipAccess = 'body' | 'dumbbell' | 'home' | 'gym';
/**
 * linear  线性加重:达到次数下限就加一档(新手期快速上行)
 * double  双渐进:先把每组次数推到区间上限,再加重回落重推(哑铃/壶铃)
 * ladder  次数阶梯:徒手动作先加次数,到顶后推荐更难变式
 * triple  三阶渐进:次数推满 → 组数加到上限 → 再加重回落到起点重来(有一定经验的人)
 */
export type ProgressionKind = 'linear' | 'double' | 'ladder' | 'triple';

export const GOAL_ZH: Record<Goal, string> = {
  fatloss: '减脂塑形', muscle: '增肌强壮', endurance: '体能耐力'
};
export const LEVEL_ZH: Record<Level, string> = {
  beginner: '新手入门', intermediate: '有一定经验'
};
export const ACCESS_ZH: Record<EquipAccess, string> = {
  body: '徒手训练', dumbbell: '有哑铃', home: '居家全套', gym: '健身房'
};
export const ACCESS_DESC: Record<EquipAccess, string> = {
  body: '不需要任何器械', dumbbell: '徒手 + 一对可调哑铃',
  home: '哑铃 + 壶铃 + 弹力带', gym: '杠铃/器械/绳索都可用'
};

export const PROGRESSION_ZH: Record<ProgressionKind, string> = {
  linear: '线性加重', double: '双渐进', ladder: '次数阶梯', triple: '三阶渐进'
};
export const PROGRESSION_DESC: Record<ProgressionKind, string> = {
  linear: '每次达标就加一档重量,新手期涨得最快',
  double: '先把每组次数推到区间上限,再加重、次数回落重新往上推',
  ladder: '先加次数,次数到顶后换更难的变式(徒手动作没有配重可加)',
  triple: '次数推满 → 加一组 → 组数加满才加重,比一路加重量更稳'
};

export type { SetType } from './settype';
import type { SetType } from './settype';

/** 单个计划动作(槽位已选定具体动作) */
export interface PlannedExercise {
  exerciseId: string;
  nameZh: string;
  /** 动作模式 id(patterns.ts 定义),用于展示与换动作 */
  patternId: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSec: number;
  progression: ProgressionKind;
  /** 当前建议负重 kg;null = 自重动作 */
  weightKg: number | null;
  /** 渐进加重步长 kg(ladder 恒为 0) */
  weightStepKg: number;
  /** 备选动作 id(用户可换,最多 3 个) */
  alternates: string[];
  /** 进阶组型(递减/力竭/金字塔/降重);旧计划无此字段 → 视为常规组 */
  setType?: SetType;
  /**
   * 这个动作安排几组热身(0 = 不热身)。缺省 = 由引擎按正式重量自动推(最多 3 组)。
   * 热身只做打勾引导,不进日志、不算容量 —— 这里调的只是「给几组」,不是处方的一部分。
   */
  warmupSets?: number;
  /**
   * 这个动作在这个训练日里的备注(「今天用窄握」「膝不舒服就减一组」)。
   * 和动作库的常驻备注(`ExerciseNotes`)是两件事:那个跟着动作走,这个跟着安排走。
   */
  note?: string;
  /** 超级组:同组 id 的动作交替进行,组间不休息(两个动作为一组) */
  superset?: string;
  /** 末组尽力(AMRAP):最后一组做完目标次数还有余力就继续做,实际次数用来校准力量基准 */
  amrapLast?: boolean;
  /** 由周期波次锁定:重量次数由 %训练最大重量 处方决定,常规渐进对它让位 */
  cycleLocked?: boolean;
  /**
   * 计时型动作的处方(秒)。**有这个字段 = 这一项按时长练**,`repsMin/repsMax`
   * 对它不参与任何计算(生成器仍然填,但那两个数只是留给旧读者不至于读到 undefined)。
   *
   * 为什么不像单侧那样复用一个字段:单侧折的是同一个量(次数)的两种数法,
   * `reps × 重量` 依旧成立;而秒和次数不是同一个量,混进 `reps` 会让容量/曲线/1RM
   * 一起算歪且不报错。详见 `timed.ts` 的头注释。
   * 旧计划没有这个字段 → 一律当次数型(和以前的行为完全一致)。
   */
  holdSec?: { min: number; max: number };
  /**
   * 单侧动作(单臂划船、弓步、单腿深蹲这类一次只练一边的)。
   * **次数口径:两侧合计**。计划里存 `repsMin: 16, repsMax: 20` 就是「每侧 8-10 次」,
   * 显示时折半(见 `sideReps`),所以次数一律按 2 走 —— 总数是偶数,两侧才分得均匀。
   * 为什么不按单侧存:那样每个读 `reps` 的地方(渐进、容量、曲线、分享卡)都得先问
   * 「这个动作是不是单侧」才知道手里的数是什么意思,漏一个地方就是一半或一倍的错。
   * 合计口径下,**容量 `reps × 重量` 天然就是两侧真实做的功**,一处都不用改。
   * 旧计划没有这个字段 → 当双侧(和以前的行为完全一致)。
   */
  sided?: boolean;
}

/**
 * 把「两侧合计」的次数折成单侧次数(双侧动作原样返回)。
 * 显示与 1RM 估算共用这一处折算 —— 二者折的是同一个事实,不能各写一份。
 * 合计是奇数时不四舍五入:8.5 说明两侧没做匀,那本身就是值得看见的信息。
 */
export function sideReps(reps: number, sided: boolean): number {
  return sided ? reps / 2 : reps;
}

/** 取整到偶数,不小于 2(单侧的次数合计必须是偶数,否则一定会出现「一侧多做一个」) */
export function evenReps(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export interface PlanDay {
  /** 计划内唯一 key,如 'full-a' / 'push' */
  key: string;
  title: string;
  focus: string;
  estMin: number;
  items: PlannedExercise[];
}

/**
 * 训练怎么排 —— 计划里的「训练日」(PlanDay)是**练什么**,这里才是**什么时候练**。
 *
 * 两份东西分开的理由和 openGym 一样:同一套「推日」既可能出现在固定周的周一,
 * 也可能在轮转里排第二。把它们焊在一起,用户改一次练哪天的安排就得复制一份训练日,
 * 而副本的渐进、历史、备注从此各走各的。
 *
 * 两种模式:
 *   · `week`     —— 周一到周日各自排好,到那天就练那天(休息日就是空);
 *   · `rotation` —— 一串训练日按顺序轮,做完最后一个再从第一个开始,
 *                  不看今天星期几。
 *
 * 固定周和轮转可以**同时**存在:轮转里没排到的固定日会在轮转旁边显示成
 * 「也固定练的日子」,当天会叠加到轮转那一套上(openGym 的 "Also on fixed days")。
 */
export interface PlanSchedule {
  mode: 'week' | 'rotation';
  /** 周一..周日(下标 0..6)→ 那天要练的训练日 key。可以多套(合并成一次训练) */
  week: string[][];
  /** 轮转顺序(去重后的训练日 key)。新训练日不会自动进来,由用户添加 */
  rotation: string[];
  /**
   * 「从今天从头开始」的日期(YYYY-MM-DD)。这一条之前的日志不参与本轮判断 ——
   * 否则刚练完一轮的人点「开始新一轮」会立刻看到自己已经全做完了。
   */
  rotationStart?: string;
}

export interface TrainingPlan {
  id: string;
  createdAt: string;
  goal: Goal;
  level: Level;
  access: EquipAccess;
  daysPerWeek: number;
  sessionMin: number;
  days: PlanDay[];
  /** 完成的训练次数(用于轮转与展示) */
  doneCount: number;
  /** 里程碑文案(plan-view 顶部展示最新一条) */
  lastNote: string;
  /** 周期安排(爬坡+减载 / 5-3-1 波次);无此字段 = 不做周期,每次照常渐进 */
  cycle?: { style: 'line' | '531'; week: number };
  /** 日程:固定周 / 轮转。缺省时按「计划里的训练日顺序轮转」解释(老计划也是这样) */
  schedule?: PlanSchedule;
}

/** 一次训练的日志 */
export interface WorkoutLog {
  id: string;
  planId: string;
  /**
   * 这一场归属的训练日。合并训练(同一天排了两套)时是几个 key 拼起来的合成 key
   * (`推+拉`),单套时就是那个训练日自己的 key。判断「哪天练过」请用 {@link logDayKeys},
   * 不要直接拿这个字段去和计划里的 dayKey 比。
   */
  dayKey: string;
  /** 合并训练里的每一个训练日 key;单套训练没有这个字段(老日志也没有) */
  dayKeys?: string[];
  dayTitle: string;
  date: string; // YYYY-MM-DD
  durationSec: number;
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  /** 本次训练的平均自感强度(RIR);无评分时为 null */
  avgRir: number | null;
  /** 本次训练的感受备注(练完可补记);无备注为 null */
  note?: string | null;
  /** 手工补录或事后修改过 — 不参与渐进推导,只进历史 */
  manual?: boolean;
  /**
   * 这次不算进步 — 伤后复出、状态很差、带病练的那一次。
   * 数据是真的(所以照常进曲线、容量、热力图),但**不作为下次目标的依据**,
   * 也不刷新纪录:那次只做了 60kg 不代表你的水平掉到 60kg,拿它去调渐进
   * 会让接下来的目标一路往下滑。
   * 和 `manual` 的区别:`manual` 是「数据记不准」,这个是「数据准,但不算数」。
   */
  noProg?: boolean;
  entries: {
    exerciseId: string;
    nameZh: string;
    /**
     * 这次训练做的是超级组(同 id 的两个动作交替做);不是超级组就没有这个字段。
     * 存下来只为让「复制成文字」这类事后阅读还能看出那两个动作是一组 ——
     * 组号本身没有别的含义,老日志没有它,那段文字就照普通动作一行一行列。
     */
    superset?: string;
    /**
     * 每组实际完成。
     *   · 次数型:`reps` 是实际次数,没有 `sec`;
     *   · 计时型:**`reps` 恒为 0**,实际时长在 `sec`。
     *
     * `reps` 归 0 而不是把秒数塞进去,是因为 `totalVolumeKg` 是 `reps × 重量` 加出来的 ——
     * 秒数一进来就会当成次数乘,于是容量、曲线、1RM 一起悄悄算歪(见 timed.ts 头注释)。
     * 于是计时组对容量的贡献正好是 0,这是对的:一次 60 秒的支撑有多「大」,
     * 用 kg×次数这个尺子量不出来,它该进的是「最长保持」那个统计。
     *
     * 旧日志没有 `sec`,一律当次数型。
     */
    sets: { reps: number; weightKg: number | null; rir: number | null; sec?: number }[];
    /**
     * 本次训练里,这个动作**不计入进阶**。
     *
     * 和上面那个整场的 `noProg` 是同一件事的两个粒度:那个是「今天整场不算」
     * (发烧、伤后复出),这个是「这一个动作不算」—— 换了台器械(重量不可比)、
     * 这组纯粹是热身性质的轻重量、动作没做标准不想让它记账。整场那个是**一个开关的取舍**,
     * 不合适的时候只能整场作废;而这几种情况里其余动作的数据都是好的,不该跟着一起丢。
     *
     * 同一条规矩:数据是真的(照常进曲线、容量、热力图),只是**不作为下次目标的依据**。
     * 老日志没有这个字段 —— 缺省就是「算」。
     */
    noProg?: true;
  }[];
}

/**
 * 这条日志练了哪几个训练日。
 * 合并训练一次记下两套,轮转/固定周的「这套练过了没有」必须按**每一套**算 ——
 * 只看 `dayKey` 的话,合并那场的另一套会被当成没练,下次又排一遍。
 */
export function logDayKeys(l: Pick<WorkoutLog, 'dayKey' | 'dayKeys'> | null | undefined): string[] {
  if (!l) return [];
  if (Array.isArray(l.dayKeys) && l.dayKeys.length) return l.dayKeys.filter((k) => typeof k === 'string' && !!k);
  return typeof l.dayKey === 'string' && l.dayKey ? [l.dayKey] : [];
}

/**
 * 这条日志能不能拿来判断「进步」—— 两个理由都算:
 * 数据记不准(`manual`)、或数据准但那次不该算数(`noProg`)。
 *
 * 只管**推导与纪录**。打卡、容量、热力图、动作曲线一律照收 ——
 * 那天确实练了,不该从历史里消失(和「补录进曲线、不进纪录」同一条规矩)。
 */
/**
 * 这一组**真的做了**吗。
 *
 * 以前到处写的都是 `s.reps > 0` —— 在只有次数型的年代它是对的。计时型进来之后
 * 这句话对**每一组静力支撑**都返回 false(它的 `reps` 恒为 0,时长在 `sec`),
 * 于是那些组会被当成「跳过没做」:复制出去的文字里整个动作消失、纪录里不算数、
 * 分享卡挑不出「最重的一组」。这个错不会报错,只会让用户看见自己的数据凭空少一块。
 *
 * 所以判据收在这里一处,**别在别处再写 `reps > 0`**(除非要的确实是次数)。
 */
export function didSet(s: { reps: number; sec?: number }): boolean {
  return s.reps > 0 || (s.sec ?? 0) > 0;
}

export function countsForProgress(log: WorkoutLog | null | undefined): boolean {
  return !!log && !log.manual && !log.noProg;
}

/**
 * 这一**条动作**能不能拿来判断「进步」。和 `countsForProgress` 是同一件事的两个粒度:
 * 那个管**整场**(发烧、伤后复出),这个管**单个动作**(换了台器械重量不可比、
 * 这一组只是热身性质的轻重量、没做标准不想记账)。
 *
 * 判断**成绩**的地方要同时过这两关 —— 只查其中一关是这条规则最典型的漏法,而且不报错:
 * 一个不该算的成绩会静静地躺在纪录里,直到哪天有人拿它去当力量基准、去调下次目标。
 *
 * 反过来,也有**故意不查**的地方,而且要留着这个区别:`exerciseHistory` 的动作曲线、
 * `refLine` 的「上次」、容量/组数/热力图 —— 那些问的是「那天发生了什么」,
 * 不是「这件事算不算成绩」。`noProg` 从来不是「删掉这笔」。
 */
export function entryCounts(log: WorkoutLog | null | undefined, entry: { noProg?: boolean }): boolean {
  return countsForProgress(log) && entry.noProg !== true;
}

/** 每动作渐进状态 */
export interface ProgressItem {
  exerciseId: string;
  weightKg: number | null;
  repsMin: number;
  repsMax: number;
  /** 当前目标组数(只有三阶渐进会改它);旧数据无此字段 → 取计划里的组数 */
  sets?: number;
  /**
   * 计时型动作的当前目标(秒)。和计划里的 `holdSec` 是同一种东西,只是这个会随渐进改。
   * 有这个字段 = 这个动作走**时长阶梯**(撑到上限 +5 秒,连续两次没到回退 5 秒,到顶换变式),
   * 和次数型那几条规则完全分开 —— 秒和次数不是同一个量,混着推会让目标一路跑偏。
   */
  holdSec?: { min: number; max: number };
  /** 连续达标次数 */
  successStreak: number;
  /** 连续未达标次数 */
  failStreak: number;
  /** 自重阶梯触发进阶变式推荐 */
  suggestion: string | null;
  updatedAt: string;
}

export interface ProgressState {
  [exerciseId: string]: ProgressItem;
}
