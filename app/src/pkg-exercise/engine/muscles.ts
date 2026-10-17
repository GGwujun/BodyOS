/**
 * 肌群统计 — 把训练日志换算成「哪个部位练了多少」。
 *
 * 动作库里的肌肉 key 很细(pectorals / upper chest / lats / traps …),统计时归成
 * 七个大组(胸/背/肩/手臂/核心腰腹/臀腿/小腿)—— 用户想知道的不是「菱形肌」,
 * 而是「这周背练少了没有」。
 *
 * 计组口径:主动肌记 1 组,次要肌记 0.5 组。卧推算 1 组胸 + 0.5 组手臂 + 0.5 组肩,
 * 和实际刺激量大致对得上,也不会让协同肌被算成主练。
 *
 * 上面这条管「一组算给谁」,`SetMetric` 管的是**哪些组算数**(全算 / 只算有效组),
 * 两个维度都定在这里,页面只挑口径、不自己数。
 */
import { isHardSet } from './effort';
import { findExercise } from './generator';
import { round2 } from './onerm';
import { addDays, isoOf } from '../../utils/date';
import type { PlanDay, WorkoutLog } from './types';

/**
 * 组数怎么算 —— 一个开关,管着这一页**所有出现「组数」的地方**(肌群图的配色与那句详情、
 * 练了多少、推拉/上下肢的比例)。少了任何一处,同一页上同一个肌群就会出现两个数。
 *
 * 「全部组」(默认)是原来那套:做了就算。但一组留了四次以上余量的动作占的是时间,
 * 给的刺激很少,把它和力竭组加在一起数,就会出现「练得挺多」和「练得够不够」对不上 ——
 * 所以多一个「只看有效组」(RIR ≤ 3,定义见 effort.ts 的 HARD_RIR)。
 *
 * 能不能给这个读法由 `canFilterHard` 说了算(评过分的组太少时,切过去看到的是被截掉一半的数),
 * 页面负责那一次判断,引擎这里只负责「给了就要算对」。
 */
export type SetMetric = 'all' | 'hard';

/**
 * 这一组算不算。**全页唯一的判据** —— 别在别处再写一遍 `s.rir <= 3`:
 * 刻度改一次就要改几个地方,漏掉的那个会静静地按老口径数。
 */
const counts = (s: { rir: number | null }, metric: SetMetric): boolean =>
  metric === 'all' || isHardSet(s.rir);

export type MuscleGroup = 'chest' | 'back' | 'shoulder' | 'arm' | 'core' | 'leg' | 'calf';

export const GROUP_ZH: Record<MuscleGroup, string> = {
  chest: '胸', back: '背', shoulder: '肩', arm: '手臂', core: '核心腰腹', leg: '臀腿', calf: '小腿'
};
/** 展示顺序:从上到下 */
export const GROUP_ORDER: MuscleGroup[] = ['chest', 'back', 'shoulder', 'arm', 'core', 'leg', 'calf'];

/** 肌肉 key → 大组(覆盖动作库 MUSCLE_ZH 的全部 key;颈/心肺不参与统计) */
const GROUP_OF: Record<string, MuscleGroup> = {
  chest: 'chest', pectorals: 'chest', 'upper chest': 'chest',
  back: 'back', lats: 'back', 'latissimus dorsi': 'back', trapezius: 'back', traps: 'back',
  rhomboids: 'back', 'lower back': 'back', 'upper back': 'back', 'levator scapulae': 'back', spine: 'back',
  'rear deltoids': 'shoulder', shoulders: 'shoulder', deltoids: 'shoulder', delts: 'shoulder',
  'rotator cuff': 'shoulder', 'serratus anterior': 'shoulder',
  'upper arms': 'arm', biceps: 'arm', triceps: 'arm', brachialis: 'arm',
  'lower arms': 'arm', forearms: 'arm', 'wrist extensors': 'arm', 'wrist flexors': 'arm',
  wrists: 'arm', 'grip muscles': 'arm', hands: 'arm',
  waist: 'core', abdominals: 'core', abs: 'core', 'lower abs': 'core', obliques: 'core', core: 'core',
  'upper legs': 'leg', quadriceps: 'leg', quads: 'leg', hamstrings: 'leg', glutes: 'leg',
  'hip flexors': 'leg', adductors: 'leg', abductors: 'leg', 'inner thighs': 'leg', groin: 'leg',
  'lower legs': 'calf', calves: 'calf', soleus: 'calf', shins: 'calf',
  'ankle stabilizers': 'calf', ankles: 'calf', feet: 'calf'
};

/**
 * 这个动作**练不练得到**某个肌群 —— 「背练得偏少 → 看练背的动作」那条反查用的判据。
 *
 * 和统计共用同一个 `groupsOf`,所以**协同肌也算**(硬拉的目标写的是下背,可它对臀腿的刺激
 * 记在次要肌里;只按 `target` 找会把这类动作整批漏掉)。这和「这周的组数怎么算到七个大组上」
 * 是同一套规矩里的两半 —— 统计里算 0.5 组的动作,在这份清单里就该出现。
 */
export const hitsGroup = (exerciseId: string, group: MuscleGroup): boolean =>
  groupsOf(exerciseId).some((x) => x.group === group);

/** 主动肌权重 1.0 / 次要肌 0.5 */
export const PRIMARY_W = 1;
export const SECONDARY_W = 0.5;

/** 该动作给各大组记多少组(动作库里没有的动作返回空) */
export function groupsOf(exerciseId: string): { group: MuscleGroup; w: number }[] {
  const ex = findExercise(exerciseId);
  if (!ex) return [];
  const out: { group: MuscleGroup; w: number }[] = [];
  const seen = new Set<MuscleGroup>();
  const add = (key: string, w: number) => {
    const g = GROUP_OF[key];
    if (!g || seen.has(g)) return; // 同一大组只记一次(避免 +0.5 又 +0.5)
    seen.add(g);
    out.push({ group: g, w });
  };
  add(ex.target, PRIMARY_W);
  for (const m of ex.secondary) add(m, SECONDARY_W);
  return out;
}

export interface MuscleStat {
  group: MuscleGroup;
  /** 计权组数(主动 1 / 次要 0.5) */
  sets: number;
  /** 纯组数(不做权重,展示"做了几组"用) */
  rawSets: number;
  /** 容量 kg(自重动作不计) */
  volumeKg: number;
}

/** 把若干次训练按肌群归并(`metric` 见 SetMetric:记全部组还是只记有效组) */
export function loadsOf(logs: WorkoutLog[], metric: SetMetric = 'all'): MuscleStat[] {
  const m = new Map<MuscleGroup, MuscleStat>();
  for (const g of GROUP_ORDER) m.set(g, { group: g, sets: 0, rawSets: 0, volumeKg: 0 });
  for (const log of logs) {
    for (const e of log.entries) {
      const gs = groupsOf(e.exerciseId);
      if (!gs.length) continue;
      // 三个数都跟着这个口径走:容量只算留下的那些组 —— 只把组数换掉的活,
      // 会让这一页同时有两个「练了多少」
      const kept = e.sets.filter((s) => counts(s, metric));
      const n = kept.length;
      const vol = kept.reduce((a, s) => a + s.reps * (s.weightKg ?? 0), 0);
      for (const { group, w } of gs) {
        const cur = m.get(group) as MuscleStat;
        cur.sets = round2(cur.sets + n * w);
        cur.rawSets += n;
        cur.volumeKg = round2(cur.volumeKg + vol * w);
      }
    }
  }
  return GROUP_ORDER.map((g) => m.get(g) as MuscleStat);
}

/**
 * 最近 N 天的肌群负荷。
 * 起点按**本地**日历天算(toISOString 是 UTC,UTC+8 的早上 8 点前窗口会宽出一天 ——
 * 「近 7 天」变成近 8 天),和计划页、统计页那几个窗口一个口径。
 */
export function recentLoads(
  logs: WorkoutLog[],
  days: number,
  metric: SetMetric = 'all',
  now = new Date()
): MuscleStat[] {
  const from = addDays(isoOf(now), -days);
  return loadsOf(logs.filter((l) => l.date >= from), metric);
}

/**
 * 计划**一轮**会给各肌群多少组 —— 「练得和计划一样吗」那张卡上的分母。
 *
 * 计权口径和 `loadsOf` **一模一样**(主动 1 / 次要 0.5),因为这两个数要在同一根条上比:
 * 口径差一点,比出来的就不是「计划做完了没」,而是两套算法之差。
 *
 * 两条容易用错的地方:
 *   · 传进来的 days 必须是**套过周期**的(`applyCycle(plan).days`)—— 直接拿 `plan.days` 的话,
 *     减载周那一周的处方已经降了一档五斤,而这里还是原样,于是用户刚按计划做完,
 *     这张卡却告诉他每个部位都差一截。
 *   · `volumeKg` 恒为 0 不是没算,是**不能算**:计划里的重量是建议值、次数是一个区间,
 *     乘出来的容量是估的。混进这个类型迟早被当成真容量加到某个总数上(要显示的是组数)。
 */
export function planLoads(days: PlanDay[]): MuscleStat[] {
  const m = new Map<MuscleGroup, MuscleStat>();
  for (const g of GROUP_ORDER) m.set(g, { group: g, sets: 0, rawSets: 0, volumeKg: 0 });
  for (const d of days) {
    for (const it of d.items) {
      // 库里查不到的动作 `groupsOf` 给的是空数组 —— 下面这个循环自己就跳过了,
      // 不需要一句 `if (!gs.length) continue`(写了也只是看着像在判什么)
      for (const { group, w } of groupsOf(it.exerciseId)) {
        const cur = m.get(group) as MuscleStat;
        cur.sets = round2(cur.sets + it.sets * w);
        cur.rawSets += it.sets;
      }
    }
  }
  return GROUP_ORDER.map((g) => m.get(g) as MuscleStat);
}

/**
 * 计划达成档 —— 「实际做了几组 / 计划几组」折成一句话。
 *
 * `plan === 0` 是单独一档:计划里没有这个部位却练了(自己加练/换了动作),
 * 那不是「超额完成」,也不该按比值算(分母是 0)。要说的是「计划里没有」。
 *
 * 门槛 0.7 是取整之后好念的数(计划 16 组、做了 11 组 → 69%,算差一点;12 组 → 75%,算够得着)。
 * 超过计划一律算「练够了」:这张卡问的是「说好要做的做了没」,多做的部分是上面那张卡的事。
 */
export function planVerdict(
  actual: number,
  plan: number
): { label: string; tone: 'none' | 'fresh' | 'warning' | 'danger' } {
  if (plan <= 0) return actual > 0 ? { label: '计划里没有', tone: 'warning' } : { label: '—', tone: 'none' };
  const pct = actual / plan;
  if (pct >= 1) return { label: '练够了', tone: 'fresh' };
  if (pct >= 0.7) return { label: '差一点', tone: 'warning' };
  return { label: '差得多', tone: 'danger' };
}

/** 只留下真的练到的肌群(按计权组数降序) */
export function trained(stats: MuscleStat[]): MuscleStat[] {
  return stats.filter((s) => s.rawSets > 0).sort((a, b) => b.sets - a.sets);
}

/**
 * 每周建议组数(大众健身的通用区间):大肌群 10-20 组,小肌群 6-12 组。
 * 超出上限不等于做错,但值得提醒 —— 加量不加恢复是最常见的停滞原因。
 */
export const WEEK_TARGET: Record<MuscleGroup, [number, number]> = {
  chest: [8, 20], back: [10, 22], shoulder: [6, 16], arm: [4, 14],
  core: [2, 12], leg: [8, 20], calf: [3, 12]
};

/** 该肌群这周的量落在哪一档 */
export function volumeVerdict(g: MuscleGroup, sets: number): { label: string; tone: 'low' | 'ok' | 'high' } {
  const [lo, hi] = WEEK_TARGET[g];
  if (sets < lo * 0.6) return { label: '几乎没练', tone: 'low' };
  if (sets < lo) return { label: '偏少', tone: 'low' };
  if (sets > hi) return { label: '偏多', tone: 'high' };
  return { label: '合适', tone: 'ok' };
}

/* ================= 推拉 / 上下肢平衡 ================= */

export type PushPull = 'push' | 'pull' | 'core';
export type UpperLower = 'upper' | 'lower';

/** 一个动作算推还是算拉 — 优先看目标肌群,拿不准就看部位 */
export function pushPullOf(exerciseId: string): PushPull | null {
  const ex = findExercise(exerciseId);
  if (!ex) return null;
  const t = ex.target;
  if (t === 'rear deltoids' || t === 'trapezius' || t === 'traps' || t === 'rhomboids'
    || t === 'lats' || t === 'latissimus dorsi' || t === 'upper back') return 'pull';
  if (t === 'biceps' || t === 'brachialis') return 'pull';
  if (t === 'pectorals' || t === 'upper chest' || t === 'chest' || t === 'serratus anterior') return 'push';
  if (t === 'triceps' || t === 'deltoids' || t === 'delts' || t === 'shoulders') return 'push';
  if (t === 'abdominals' || t === 'abs' || t === 'obliques' || t === 'core' || t === 'waist') return 'core';
  switch (ex.bodyPart) {
    case 'chest': return 'push';
    case 'shoulders': return 'push';
    case 'back': return 'pull';
    case 'upper arms': return 'pull';   // 手臂动作里弯举更多,拿不准时按拉算
    case 'lower arms': return 'pull';
    case 'waist': return 'core';
    default: return null;               // 腿/小腿/颈等不参与推拉比
  }
}

export function upperLowerOf(exerciseId: string): UpperLower | null {
  const p = pushPullOf(exerciseId);
  if (p === 'core') return null;
  if (p) return 'upper';
  const bp = findExercise(exerciseId)?.bodyPart;
  if (bp === 'upper legs' || bp === 'lower legs') return 'lower';
  if (bp === 'neck') return null;
  return bp ? 'upper' : null;
}

export interface Balance {
  pushSets: number;
  pullSets: number;
  upperSets: number;
  lowerSets: number;
  /** 推拉相差的百分比(正数=推多);样本太少时为 null */
  pushPullSkew: number | null;
  upperLowerSkew: number | null;
  tips: string[];
}

/** 推拉 / 上下肢平衡诊断 — 样本太少(少于 6 组)不下结论(`metric` 同页面口径) */
export function balanceOf(logs: WorkoutLog[], metric: SetMetric = 'all'): Balance {
  let push = 0; let pull = 0; let upper = 0; let lower = 0;
  for (const log of logs) {
    for (const e of log.entries) {
      const n = e.sets.filter((s) => counts(s, metric)).length;
      const p = pushPullOf(e.exerciseId);
      if (p === 'push') push += n;
      else if (p === 'pull') pull += n;
      const ul = upperLowerOf(e.exerciseId);
      if (ul === 'upper') upper += n;
      else if (ul === 'lower') lower += n;
    }
  }
  const skew = (a: number, b: number) => (a + b >= 6 ? Math.round(((a - b) / (a + b)) * 100) : null);
  const pushPullSkew = skew(push, pull);
  const upperLowerSkew = skew(upper, lower);

  const tips: string[] = [];
  if (pushPullSkew != null && Math.abs(pushPullSkew) >= 25) {
    tips.push(pushPullSkew > 0
      ? `推的动作比拉多 ${pushPullSkew}%:胸口紧、肩膀容易往前扣,加两组划船/面拉把背补上。`
      : `拉的动作比推多 ${-pushPullSkew}%:背面做得足,别忘了卧推/推举把胸肩跟上。`);
  }
  if (upperLowerSkew != null && Math.abs(upperLowerSkew) >= 40) {
    tips.push(upperLowerSkew > 0
      ? `上肢比下肢多 ${upperLowerSkew}%:腿是全身代谢的大头,别总是跳过练腿日。`
      : `下肢比上肢多 ${-upperLowerSkew}%:加上推举与划船,上半身线条会更完整。`);
  }
  return { pushSets: push, pullSets: pull, upperSets: upper, lowerSets: lower, pushPullSkew, upperLowerSkew, tips };
}
