/**
 * 重量口径 — 计划与日志里的 `weightKg` 只有一个数字,但它的含义随动作而变:
 *   · **负重**(杠铃/哑铃/器械…):数字就是总负重,越重越强;
 *   · **助力**(助力引体向上这类助力器械):数字是器械替你分担的力,**越大越轻松**;
 *   · **附加重量**(负重自重:负重引体、负重双杠):数字只是**加在自身体重之上**的那部分,
 *     真正的负荷是「体重 + 这个数」。
 *
 * 三种口径在下游的差别只有一个:**助力不能当负重算**。
 * 拿助力去估 1RM,人越练越弱数字反而越高 —— 「估 1RM」「力量基准」「力量保持」
 * 会一起虚高,周期波次还会拿这个假基准去开 %1RM 的处方重量。所以助力动作一律:
 * 不进 1RM 类成绩、不做负重热身、渐进只往「**减少**助力」的方向走(见 progression.ts)。
 *
 * 判定沿 openGym 的口径(exercises.js 的 `ASSISTED_EQ` / `assistedName`),必须**同时**满足
 * 器械是 leverage machine、并且名字里有 assist —— 只看名字会把弹力带助力、同伴助力、
 * 器械辅助拉伸都卷进来(它们不是负重器械,本来也不算 1RM);只看器械会把 leverage machine
 * 里的普通器械(坐姿推胸、腿举…)当助力,那就把正常的 1RM 全砍了。
 *
 * **负重自重(`weighted`)不走这条**:它的方向是对的,只是数字不完整 ——
 * 显示时补一个 `+` 就够(openGym 的 history.js 也是这么显示的),数学一个字不用改。
 */
import { EXERCISES } from '../data/exercises';
import { findCustom } from './custom';
import { isSided } from './sided';
import { E1RM_MAX_REPS, e1rmOf, round2 } from './onerm';
import { warmupSets, type WarmupSet } from './warmup';

/** 助力器械的器械名(与动作库里的取值一致) */
const ASSISTED_EQUIP = 'leverage machine';
/** 助力器械的名字特征(英文原名一定判得到;中文名是译名,一并认) */
const ASSISTED_NAME = /assist(ed)?|助力/i;
/** 附加重量类器械:数字是加在自重之上的那部分 */
const ADDED_EQUIP = 'weighted';

let assistedIds: Set<string> | null = null;
let addedIds: Set<string> | null = null;

function scan(): void {
  if (assistedIds && addedIds) return;
  assistedIds = new Set<string>();
  addedIds = new Set<string>();
  for (const e of EXERCISES) {
    if (e.equipment === ASSISTED_EQUIP && (ASSISTED_NAME.test(e.name) || ASSISTED_NAME.test(e.nameZh))) {
      assistedIds.add(e.id);
    }
    if (e.equipment === ADDED_EQUIP) addedIds.add(e.id);
  }
}

/**
 * 是不是**助力器械**动作(助力引体向上、助力双杠臂屈伸…)。
 * 这类动作的 `weightKg` 是器械帮你的力,不是负重 —— 不能用它算 1RM,也不能按「加重」渐进。
 *
 * 自定义动作**先问它自己**:上面那条判定要「英文原名里有 assist」,而用户起的
 * 中文名字(「我的助力引体机」)不在那套规则里 —— 创建时勾的那个开关才是事实
 * (见 custom.ts;表单会在名字里出现「助力」时提醒他勾上,但不替他决定)。
 */
export function isAssisted(exerciseId: string): boolean {
  const c = findCustom(exerciseId);
  if (c) return c.assisted;
  scan();
  return assistedIds!.has(exerciseId);
}

/** 是不是**负重自重**动作(负重引体/负重双杠):数字只是附加在自身体重之上的那部分 */
export function isAddedWeight(exerciseId: string): boolean {
  const c = findCustom(exerciseId);
  // 自定义动作没有名字可判,**只有器械**这一个判据 —— 和库里那条一样(库里也是只看器械)
  if (c) return c.equipment === ADDED_EQUIP;
  scan();
  return addedIds!.has(exerciseId);
}

/**
 * 这个动作的 `weightKg` 该叫什么(字段名/图表轴用)。
 * 「重量」两字在助力动作上是反的 —— 用户看到「助力 30kg」才知道这个数大了是更轻松。
 */
export function weightNoun(exerciseId: string): string {
  if (isAssisted(exerciseId)) return '助力';
  if (isAddedWeight(exerciseId)) return '附加重量';
  return '重量';
}

/**
 * 数字前面那一下:`''`(普通负重)| `'+'`(附加重量)| `'助力 '`(助力器械)。
 * 和 `loadText` 分开是因为页面里数字和单位常常是两个 `<Text>`(单位要小一号、灰色)。
 */
export function loadPrefix(exerciseId: string): string {
  if (isAssisted(exerciseId)) return '助力 ';
  return isAddedWeight(exerciseId) ? '+' : '';
}

/**
 * 把 `weightKg` 说成一句用户不会误读的话:
 *   自重 | 助力 30kg | +20kg | 30kg
 * 全站显示重量都走这里 —— 少一个地方补 `+`,用户就会把负重引体的「20kg」当成总负荷。
 */
export function loadText(exerciseId: string, weightKg: number | null | undefined, unit = 'kg'): string {
  const w = weightKg ?? 0;
  if (!(w > 0)) return '自重';
  return `${loadPrefix(exerciseId)}${round2(w)}${unit}`;
}

/**
 * 一组动作的 1RM —— **知道动作 id 时一律从这里进**(不知道 id 的纯数学场景才直接调 `onerm.e1rmOf`)。
 *
 * 比 `e1rmOf` 多的一件事:助力动作返回 0(没有成绩)。
 * 这一条只能放在闸门里 —— 漏一处不会报错,只会悄悄多出一条假纪录、一个虚高的力量基准。
 */
export function liftE1rm(
  exerciseId: string,
  reps: number,
  weightKg: number | null | undefined,
  sided = isSided(exerciseId),
  maxReps = E1RM_MAX_REPS
): number {
  if (isAssisted(exerciseId)) return 0;
  return e1rmOf(weightKg, reps, sided, maxReps);
}

/**
 * 热身组 —— 助力动作没有负重热身这回事。
 * 热身组是按「正式重量的百分之多少」推的,而助力的 40% 是「少帮一点」,
 * 既不是热身也不是正式组,写出来只会让人看不懂。助力动作活动开关节直接上。
 */
export function warmupFor(
  exerciseId: string,
  workWeightKg: number | null | undefined,
  step = 2.5,
  maxSets = 3,
  sided = false
): WarmupSet[] {
  if (isAssisted(exerciseId)) return [];
  return warmupSets(workWeightKg ?? null, step, maxSets, sided);
}
