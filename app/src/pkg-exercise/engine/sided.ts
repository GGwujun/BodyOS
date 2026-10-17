/**
 * 单侧动作 — 哪些动作一次只练一边(单臂划船、弓步、单腿深蹲),以及次数该怎么说。
 *
 * **口径(整条链路只有这一个)**:次数一律记**两侧合计**。
 *   计划里 16-20 次 = 每侧 8-10 次;日志里存 24 = 每侧 12 次;
 *   显示时折半(「每侧 12 次」),录入时按 2 递增 —— 总数保持偶数,两侧才分得匀。
 *
 * 为什么不按单侧存:那样每一个读 `reps` 的地方(渐进比对目标、容量、曲线、1RM、分享卡)
 * 都得先问一句「这个动作是不是单侧」才知道手里的数是什么意思 —— 漏一个地方就是一半或
 * 一倍的错,而且这种错不会报错,只会悄悄算歪。合计口径下:
 *   · 容量 `reps × 重量` 天然是两侧真实做的功,一处都不用改;
 *   · 渐进的「达标没有」直接比合计目标与合计实际,也不用折;
 *   · **只有 1RM 要折** —— Epley 拿 16 次外推和拿 8 次外推差得远,那一步交给 `onerm.e1rmOf`。
 *
 * 顺带说清楚**没做的**:真正「左右分开记」(左 12 右 8 这种不对称记录)没有移植 ——
 * 那会把每一组的数据结构变成嵌套的,日志/历史/曲线/容量/分享/同步/备份全都要认新形状,
 * 只为接住「一侧有伤只能少做」这一个场景。BodyOS 里那个场景有更简单的出口:
 * 动作常驻备注写一句,或者那次直接标「这次不算进步」(见 types.countsForProgress)。
 */

import { EXERCISES } from '../data/exercises';
import { findCustom } from './custom';
import { evenReps, type TrainingPlan } from './types';

/**
 * 名字里带这些就是单侧(在英文原名上判 —— 中文名未必翻译出来,英文名一定有)。
 * 每一条都是**量过动作库**才留下的(1,324 条里命中数在注释里):
 */
const SIDED_RE = new RegExp([
  '(single|one)[ -](arm|leg|foot)',  // 单臂/单腿/单脚(120 + 39)
  'alternat',                        // 交替(38):alternate / alternating
  'split squat|bulgarian',           // 分腿蹲、保加利亚蹲(11)
  'lunge',                           // 弓步(21)—— 弓步没有两侧一起做的
  'step[ -]?up',                     // 登台阶(6)
  'pistol',                          // 手枪蹲(2)
  'concentration',                   // 集中弯举(13)—— 都是单臂
  'kickback',                        // 后踢(11)—— 都是单臂
  'dead bug|bird dog',               // 死虫、鸟狗 —— 本就是对侧交替
  'pallof|suitcase',                 // 抗旋转推、手提箱
  'renegade|archer|turkish|windmill',// 划船、弓箭手、土耳其起立、风车
  'cossack|curtsy|skater',           // 哥萨克蹲、交叉弓步、滑冰跳
].join('|'));

/**
 * 名字像但**不是**单侧的(在匹配之后再排除,免得把反向的规则写进正则里):
 *   · side split squat —— 名字里的 side 是「横叉式」的宽站距深蹲,两条腿一起蹲;
 *   · double windmill —— 双手壶铃风车,左右一起。
 */
const NOT_SIDED_RE = /side split squat|double windmill/;

let cache: Set<string> | null = null;

/** 单侧动作 id 集合 —— 全库扫一遍,只做一次(之后每次调用只是查集合) */
function sidedIds(): Set<string> {
  if (cache) return cache;
  const ids = new Set<string>();
  for (const e of EXERCISES) {
    const name = (e.name || '').toLowerCase();
    if (SIDED_RE.test(name) && !NOT_SIDED_RE.test(name)) ids.add(e.id);
  }
  cache = ids;
  return cache;
}

/** 这个动作是不是单侧(次数按两侧合计记、显示时折半) */
export function isSided(exerciseId: string): boolean {
  // 自定义动作**先问它自己**:上面那套判据是在英文原名上跑正则(「one arm…」「lunge」),
  // 而用户起的名字(「我的推胸机」)根本不在射程里 —— 那就永远判不出单侧,
  // 次数会被当成一次做完的总数。创建时勾的那个开关才是这个动作的事实(见 custom.ts)。
  const c = findCustom(exerciseId);
  if (c) return c.sided;
  return sidedIds().has(exerciseId);
}

/** 次数按几递增 —— 单侧走 2,保证两侧分得均匀(`evenReps` 在 types.ts,数据无关那半边) */
export function repStepOf(sided: boolean | undefined): number {
  return sided ? 2 : 1;
}

/** 计划里那一行次数怎么说:「16-20 次(每侧 8-10)」 */
export function sideRangeText(repsMin: number, repsMax: number, sided: boolean | undefined): string {
  const base = repsMin === repsMax ? `${repsMax} 次` : `${repsMin}-${repsMax} 次`;
  if (!sided) return base;
  const lo = sideRepsText(repsMin);
  const hi = sideRepsText(repsMax);
  return `${base}(每侧 ${lo === hi ? lo : `${lo}-${hi}`})`;
}

/** 单侧次数说人话:整数就是整数,折出半个(合计是奇数)也照实说 */
export function sideRepsText(total: number): string {
  const half = total / 2;
  return Number.isInteger(half) ? String(half) : half.toFixed(1);
}

/** 录入时那一行的小标:每侧几次 */
export function perSideText(reps: number): string {
  return `每侧 ${sideRepsText(reps)} 次`;
}

/**
 * 散落在各处的一行「某个动作、某一组做了多少次」怎么念。
 * 纪录、掉力分析、分享卡都要这一句,写在各自页面里迟早有一处忘了折 —— 那处就会
 * 把两侧合计当成一次做的次数说出来(数字翻倍,而且看不出错)。
 *
 * `sided` 传了就以它为准(日志里不存这个,现问计划 —— 用户手动关掉过单侧开关的动作
 * 不该被动作库的名字规则又翻回来,见下面的 sidedInPlan)。
 */
export function sideRepsLabel(exerciseId: string, reps: number, sided?: boolean): string {
  return (sided ?? isSided(exerciseId)) ? `每侧 ${sideRepsText(reps)}` : String(reps);
}

/**
 * 这次训练里这个动作是不是单侧 —— 日志不存这个(存了就要跟着计划改),一律现问计划。
 * 计划里还有这个动作就以它为准:用户手动关掉过单侧开关的动作不能被动作库的名字规则
 * 又翻回来;计划里已经没有了(换过动作的老日志)才退回名字判断。
 */
export function sidedInPlan(plan: TrainingPlan | null | undefined, exerciseId: string): boolean {
  const it = plan?.days.flatMap((d) => d.items).find((x) => x.exerciseId === exerciseId);
  return it ? Boolean(it.sided) : isSided(exerciseId);
}

/**
 * 把次数从一种口径折到另一种(双侧 ↔ 单侧合计),**保持「每侧做几次」不变**:
 * 打开 12 → 24(还是每侧 12),关掉 24 → 12。
 *
 * 换动作(单侧换双侧)和编辑器里手动开关都要用它 —— 这个折算是「次数到底是什么意思」的
 * 唯一翻译层,两处各写一遍迟早有一处忘了折,而忘了折不会报错,只会让处方悄悄差一倍。
 */
export function rescaleReps(reps: number, toSided: boolean): number {
  // 折成合计走 evenReps(单侧那边必须偶数,否则一定有一侧少做一个);
  // 折回双侧就不必取偶 —— 两侧一起做,12 次和 13 次没有区别
  return toSided ? evenReps(reps * 2) : Math.max(1, Math.round(reps / 2));
}
