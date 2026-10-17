/**
 * 计划编辑器 — 对 TrainingPlan 的纯变换(不可变返回新对象)。
 * 全部操作无副作用,页面只负责「调函数 → savePlan → setState」,便于单测。
 */
import type { ExerciseEntry } from '../data/exercises';
import { bestPatternOf, estMinutes, buildItem, candidatesFor } from './generator';
import { isAssisted } from './load';
import { cleanUnits, movePlanItem } from './order';
import { PATTERNS } from './patterns';
import { rescaleReps } from './sided';
import { setTypeAvailable, type SetType } from './settype';
import type { PlanDay, PlannedExercise, ProgressionKind, TrainingPlan } from './types';

/** 组次变化后重算单堂时长 */
const reEst = (d: PlanDay): PlanDay => ({ ...d, estMin: estMinutes(d.items) });

/* ============================ 单个动作的纯变换 ============================ */
/**
 * 下面这几个函数改的是**一个 PlannedExercise**,不碰计划结构。
 *
 * 为什么单独拎出来:同一个动作参数面板要在两处用 —— 计划编辑器的「动作参数」,
 * 和动作库「加入计划」时的设置步骤。两处各写一套改重量的规则,迟早出现
 * 「编辑器里能把自重动作加成负重、加计划那边加完却还在按次数阶梯推」这种
 * 不会报错的错(渐进方式和有没有重量必须同时成立,见 progression.ts)。
 * 规则只写在这里,两处都调它。
 */

/** 重量清洗:空/0/负数一律当自重(null),其余取到 0.01kg */
export const cleanWeight = (w: number | null | undefined): number | null => {
  const n = typeof w === 'number' ? w : Number(w);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * 改负重。**渐进方式跟着一起改**,因为二者必须互相成立:
 *  - 变成自重 → 只能走次数阶梯(ladder);
 *  - 变成负重 → 不能还停在 ladder(老计划里存着这种组合,靠 setProgression 兜底,
 *    但用户在这一刻改的重量,该在这一刻就把规则换过来)。
 * 助力器械永远是 ladder:它的数字是助力,「加重」方向反了(见 engine/load.ts)。
 * 组型跟着过一遍闸门:金字旁的组型需要配重,重量被拿掉就退回常规组。
 */
export function withWeight(it: PlannedExercise, weight: number | null | undefined): PlannedExercise {
  const w = cleanWeight(weight);
  if (w === (it.weightKg ?? null)) return it;
  const assisted = isAssisted(it.exerciseId);
  let progression = it.progression;
  if (assisted) progression = 'ladder';
  else if (w == null) progression = 'ladder';
  else if (progression === 'ladder') progression = 'linear';
  const setType = setTypeAvailable(it.setType ?? 'normal', w) ? (it.setType ?? 'normal') : 'normal';
  return { ...it, weightKg: w, progression, setType };
}

/** 左右交替:切换时把次数区间折过来,保持「每侧几次」不变(见 sided.rescaleReps) */
export function withSided(it: PlannedExercise, on: boolean): PlannedExercise {
  if (Boolean(it.sided) === on) return it;
  return {
    ...it,
    sided: on || undefined,
    repsMin: rescaleReps(it.repsMin, on),
    repsMax: rescaleReps(it.repsMax, on)
  };
}

/** 这个动作能不能换成该渐进方式(助力器械只能 ladder;自重与负重不能互串) */
export function canSetProgression(it: PlannedExercise, kind: ProgressionKind): boolean {
  if (isAssisted(it.exerciseId)) return kind === 'ladder';
  return (it.weightKg == null) === (kind === 'ladder');
}

export function withProgression(it: PlannedExercise, kind: ProgressionKind): PlannedExercise {
  if (it.progression === kind || !canSetProgression(it, kind)) return it;
  return { ...it, progression: kind };
}

/** 组型是否可用 —— 依赖配重的组型在自重动作上不可用;少于两组时只有常规/力竭成立 */
export function canSetSetType(it: PlannedExercise, type: SetType): boolean {
  return setTypeAvailable(type, it.weightKg) && (type === 'normal' || type === 'failure' || it.sets >= 2);
}

export function withSetType(it: PlannedExercise, type: SetType): PlannedExercise {
  if ((it.setType ?? 'normal') === type || !canSetSetType(it, type)) return it;
  return { ...it, setType: type };
}

/** 替换某天的 items 并重算时长 */
function withDay(plan: TrainingPlan, di: number, fn: (d: PlanDay) => PlanDay): TrainingPlan {
  const days = plan.days.map((d, i) => (i === di ? reEst(fn(d)) : d));
  return { ...plan, days };
}

/** 动作在该计划任意训练日里是否已出现(避免同一天/计划内重复) */
export function dayHasExercise(plan: TrainingPlan, di: number, exerciseId: string): boolean {
  return plan.days[di]?.items.some((it) => it.exerciseId === exerciseId) ?? false;
}

/** 换动作时重算备选:同模式下该器械条件可用的其它动作,取前 3 */
function alternatesFor(plan: TrainingPlan, patternId: string, exerciseId: string): string[] {
  return candidatesFor(patternId, plan.access, plan.level)
    .filter((e) => e.id !== exerciseId)
    .slice(0, 3)
    .map((e) => e.id);
}

/**
 * 上移/下移动作(越界返回原计划)。
 * 一次一步,但**超级组是一整块**:组内两个成员换位,走到边缘把成员挪出相邻位置时,
 * 这个超级组跟着解散(见 engine/order.ts 开头)。留下「两个隔开的动作共用一个组号」
 * 会让没有同伴的动作挂着「超级组」徽标,训练页的「接着做 X」也会指到一个老远的动作上。
 */
export function moveItem(plan: TrainingPlan, di: number, ii: number, delta: number): TrainingPlan {
  return moveItemDetailed(plan, di, ii, delta)?.plan ?? plan;
}

/** 同上,另外回报这一下解散了几个超级组成员(页面要据此说一句「超级组已解除」) */
export function moveItemDetailed(
  plan: TrainingPlan,
  di: number,
  ii: number,
  delta: number
): { plan: TrainingPlan; dissolved: number } | null {
  const items = plan.days[di]?.items;
  if (!items) return null;
  const moved = movePlanItem(items, ii, delta);
  if (!moved) return null;
  return {
    plan: withDay(plan, di, (d) => ({ ...d, items: moved.rows as PlannedExercise[] })),
    dissolved: moved.dissolved
  };
}

/** 删除动作 —— 顺手解散被删剩单的那个超级组(否则孤儿组号会一直挂在同伴身上) */
export function removeItem(plan: TrainingPlan, di: number, ii: number): TrainingPlan {
  if (!plan.days[di]?.items[ii]) return plan;
  return withDay(plan, di, (d) => ({
    ...d,
    items: cleanUnits(d.items.filter((_, i) => i !== ii)) as PlannedExercise[]
  }));
}

/** 改组数/次数/休息等字段 */
export function patchItem(plan: TrainingPlan, di: number, ii: number, patch: Partial<PlannedExercise>): TrainingPlan {
  if (!plan.days[di]?.items[ii]) return plan;
  return withDay(plan, di, (d) => ({
    ...d,
    items: d.items.map((it, i) => (i === ii ? { ...it, ...patch } : it))
  }));
}

/** 追加动作(用动作库条目 + 模式槽位默认规则构造) */
export function addItem(plan: TrainingPlan, di: number, patternId: string, ex: ExerciseEntry): TrainingPlan {
  if (!plan.days[di] || !PATTERNS[patternId]) return plan;
  const item: PlannedExercise = {
    ...buildItem(patternId, ex, plan.goal, plan.level),
    alternates: alternatesFor(plan, patternId, ex.id)
  };
  return withDay(plan, di, (d) => ({ ...d, items: [...d.items, item] }));
}

/**
 * 从动作库里挑中一个动作、直接加进某个训练日 —— 动作库详情的「加入计划」走这条。
 *
 * 和上面 addItem 的区别有两处,都是「谁在调用」决定的:
 *
 * ①**模式槽位由动作自己算**。编辑器里是用户**先选模式**(下拉里那些「水平推」「垂直拉」),
 *   而他在动作库里翻到一个动作时,想的只是「这个我想练」,不是「这属于哪个模式」——
 *   所以这里走 bestPatternOf(和 plan-text 导入手写计划时同一条路)。两处最后都落到
 *   addItem,所以加出来的条目逐格一致(组数/次数/休息都是 plan.goal + plan.level 推出来的),
 *   不会出现「动作库加进去的比编辑器加进去的少两格」。
 *
 * ②**认的是训练日的 key,不是下标**。从「打开选哪天」到「点下去」中间隔着用户思考的时间,
 *   这期间云同步完全可能把云端那份整份落到本机(切后台就会跑),而计划是按**位置**存的 ——
 *   用下标就会加到**换过来的那一天**上,而且不报错(见 utils/sync 与 M10.12 那条 CAS 的教训)。
 *   key 才是训练日的身份,下标只是它此刻的位置。
 *
 * 这一天已经不在计划里了(在别处删掉/云同步换了一份)返回原对象**同引用**,
 * 调用方靠 `=== plan` 就能判断,如实告诉用户,不要凭下标硬加。
 */
export function addExerciseToDay(plan: TrainingPlan, dayKey: string, ex: ExerciseEntry): TrainingPlan {
  const di = plan.days.findIndex((d) => d.key === dayKey);
  if (di < 0) return plan;
  return addItem(plan, di, bestPatternOf(ex.id, plan.level), ex);
}

/**
 * 把**已经配置好**的动作插进某个训练日 —— 动作库「加入计划」第二步走这条。
 *
 * 和 addExerciseToDay 的区别:那条用生成器的默认处方,这条让用户在加之前就把
 * 组数/次数/重量/热身/休息/组型/渐进/备注调好(默认值来自 buildItem,所以没动过的格子
 * 与「＋动作」加出来的逐格一致)。`patternId` 由动作自己认(和 addExerciseToDay 同一条)。
 * 仍然认 key 不认下标,理由见上面那段注释。
 */
export function addConfiguredItem(
  plan: TrainingPlan,
  dayKey: string,
  ex: ExerciseEntry,
  patch: Partial<PlannedExercise>
): TrainingPlan {
  const di = plan.days.findIndex((d) => d.key === dayKey);
  if (di < 0) return plan;
  const pid = bestPatternOf(ex.id, plan.level);
  if (!PATTERNS[pid]) return plan;
  const item: PlannedExercise = {
    ...buildItem(pid, ex, plan.goal, plan.level),
    ...patch,
    exerciseId: ex.id,
    nameZh: ex.nameZh,
    patternId: pid,
    alternates: alternatesFor(plan, pid, ex.id)
  };
  return withDay(plan, di, (d) => ({ ...d, items: [...d.items, item] }));
}

/** 把第 ii 个动作换成另一个动作(可同时换模式) */
export function replaceItem(plan: TrainingPlan, di: number, ii: number, patternId: string, ex: ExerciseEntry): TrainingPlan {
  if (!plan.days[di]?.items[ii] || !PATTERNS[patternId]) return plan;
  const item: PlannedExercise = {
    ...buildItem(patternId, ex, plan.goal, plan.level),
    alternates: alternatesFor(plan, patternId, ex.id)
  };
  // 保留用户已调整过的组数/次数/休息/组型(换动作通常只想换动作本身)
  const prev = plan.days[di].items[ii];
  // 换成单侧动作(或反过来)时次数得跟着折:留着 12 次给单臂划船,就成了「每侧 6 次」,
  // 用户看到的处方会无声地少一半。按「每侧几次」不变折算(见 side.rescaleReps)。
  const sameSide = Boolean(item.sided) === Boolean(prev.sided);
  const keep: PlannedExercise = {
    ...item,
    sets: prev.sets,
    repsMin: sameSide ? prev.repsMin : rescaleReps(prev.repsMin, Boolean(item.sided)),
    repsMax: sameSide ? prev.repsMax : rescaleReps(prev.repsMax, Boolean(item.sided)),
    restSec: prev.restSec,
    setType: prev.setType ?? 'normal',
    superset: prev.superset
  };
  return withDay(plan, di, (d) => ({ ...d, items: d.items.map((it, i) => (i === ii ? keep : it)) }));
}

/**
 * 改组型 — 不适用当前动作的组型(自重动作的递减/金字塔)自动拒绝;
 * 组型依赖配重时,组数少于 2 也退回常规。
 */
export function setItemType(plan: TrainingPlan, di: number, ii: number, type: SetType): TrainingPlan {
  const it = plan.days[di]?.items[ii];
  if (!it) return plan;
  const next = withSetType(it, type);
  return next === it ? plan : patchItem(plan, di, ii, { setType: next.setType });
}

/**
 * 与下一个动作组成 / 解除超级组。
 * 超级组 = 两个动作交替做、组间不休息(只有做完两个动作才算一轮);
 * 所以必须是相邻两个动作,且都不在别的超级组里。
 */
export function toggleSuperset(plan: TrainingPlan, di: number, ii: number): TrainingPlan {
  const d = plan.days[di];
  if (!d || ii < 0 || ii >= d.items.length - 1) return plan;
  const cur = d.items[ii];
  const nxt = d.items[ii + 1];
  const paired = Boolean(cur.superset && cur.superset === nxt.superset);
  const gid = paired ? undefined : `ss-${ii}-${Date.now().toString(36).slice(-4)}`;
  return withDay(plan, di, (day) => ({
    ...day,
    items: day.items.map((it, i) => {
      if (i !== ii && i !== ii + 1) return it;
      const next = { ...it };
      if (gid) next.superset = gid;
      else delete next.superset;
      return next;
    })
  }));
}

/**
 * 改渐进方式 — 徒手动作只能走次数阶梯,负重动作才有加重语义(两者不能互串)。
 * 助力器械(助力引体向上这类)只能走次数阶梯:它的数字是器械帮你的力,
 * 「加重」等于把动作变轻松,渐进方向是反的(见 engine/load.ts)。
 * 已经走过的动作保留自己的组数记录,只换规则。
 */
export function setProgression(plan: TrainingPlan, di: number, ii: number, kind: ProgressionKind): TrainingPlan {
  const it = plan.days[di]?.items[ii];
  if (!it) return plan;
  const next = withProgression(it, kind);
  return next === it ? plan : patchItem(plan, di, ii, { progression: next.progression });
}

/** 该动作是否处于超级组中(展示用) */
export function inSuperset(it: PlannedExercise): boolean {
  return Boolean(it.superset);
}

/** 改训练日标题 */
export function renameDay(plan: TrainingPlan, di: number, title: string): TrainingPlan {
  const t = title.trim();
  if (!plan.days[di] || !t) return plan;
  return withDay(plan, di, (d) => ({ ...d, title: t.slice(0, 8) }));
}

/** 训练日上移/下移 */
export function moveDay(plan: TrainingPlan, di: number, delta: number): TrainingPlan {
  const to = di + delta;
  if (to < 0 || to >= plan.days.length) return plan;
  const days = [...plan.days];
  [days[di], days[to]] = [days[to], days[di]];
  return { ...plan, days };
}

/** 删除训练日(至少保留一天) */
export function removeDay(plan: TrainingPlan, di: number): TrainingPlan {
  if (plan.days.length <= 1 || !plan.days[di]) return plan;
  return { ...plan, days: plan.days.filter((_, i) => i !== di), daysPerWeek: plan.days.length - 1 };
}

/** 新增一个空白训练日 */
export function addDay(plan: TrainingPlan): TrainingPlan {
  const used = new Set(plan.days.map((d) => d.key));
  let n = 1;
  while (used.has(`custom-${n}`)) n++;
  const day: PlanDay = { key: `custom-${n}`, title: `自主训练 ${n}`, focus: '自由编排', estMin: 5, items: [] };
  return { ...plan, days: [...plan.days, day], daysPerWeek: plan.days.length + 1 };
}

/**
 * 复制品的名字:去掉原件名结尾的「 2」再往后排 —— 「推日 2」再复制出来是「推日 3」,
 * 不是「推日 2 2」。上限 8 个字跟编辑框(`maxlength={8}`)和 renameDay 的 `slice(0, 8)` 一致:
 * 复制出来的名字要是超了上限,用户点开设置随手一存就会被截短 —— 那是复制的那一刻
 * 就埋下的「名字会自己变」,不如当场就按存得下的长度取。
 */
function copyTitle(taken: readonly string[], base: string): string {
  const stem = base.replace(/ \d+$/, '').trim() || '训练日';
  const set = new Set(taken);
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    // 后缀本身就可能占满 8 个字(名字排到「 1000」),留一格给主体,别让 slice 拿到负数
    const room = Math.max(1, 8 - suffix.length);
    const t = `${stem.slice(0, room).trimEnd()}${suffix}`;
    if (!set.has(t)) return t;
  }
}

/**
 * 复制一个训练日 —— 连带动作编排一起,插在**原件的后面**(不是追加到计划末尾)。
 * 「推日」和「拉日」大半是同一套辅助动作,从零编排一遍是十几下「＋」,复制之后通常只改一两处。
 * 位置也是这个意思:复制出来的是「刚在改的这天」的邻居,追加到末尾会离它十几屏远,
 * 用户点完「复制这天」眼前什么也没变(新的一天在屏幕下头),会以为没生效。
 *
 * 三件容易漏掉的事:
 * ①**key 要重发**(照 plan-text 导入时的规矩 `${key}-${n}`)。key 才是训练日的身份 ——
 *   「改练」把某一天指定给某个日期、动作库的「加入计划」按键找天,都是按键找的;
 *   两天共用一个 key,就会出现「点的是这一天,练的是那一天的处方」。
 * ②**超级组号原样抄过来**。组号只在**同一天内部**比较(见 engine/order.ts),两天各有一组
 *   同名组号不会串台;重发组号反而会把复制品里配好的超级组拆散,那才是丢信息。
 * ③**嵌套字段要真复制**。`{...it}` 只到第一层,`holdSec` 和 `alternates` 还是原件那两个对象,
 *   以后谁就地改一下,改动会同时落到两个训练日上 —— 复制品从这一刻起就不是独立的了。
 *
 * 下标越界返回原对象**同引用**(和别的操作一致,页面靠它判断这一下没有发生)。
 */
export function duplicateDay(plan: TrainingPlan, di: number): TrainingPlan {
  const src = plan.days[di];
  if (!src) return plan;
  const used = new Set(plan.days.map((d) => d.key));
  let key = `${src.key}-2`;
  for (let n = 3; used.has(key); n++) key = `${src.key}-${n}`;
  const copy: PlanDay = reEst({
    ...src,
    key,
    title: copyTitle(plan.days.map((d) => d.title), src.title),
    items: src.items.map((it) => ({
      ...it,
      ...(it.alternates ? { alternates: [...it.alternates] } : {}),
      ...(it.holdSec ? { holdSec: { ...it.holdSec } } : {})
    }))
  });
  const days = [...plan.days];
  days.splice(di + 1, 0, copy);
  return { ...plan, days, daysPerWeek: days.length };
}

/** 是否可开始训练:至少一天且有动作 */
export function isTrainable(plan: TrainingPlan): boolean {
  return plan.days.some((d) => d.items.length > 0);
}
