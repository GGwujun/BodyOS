/**
 * 训练顺序 —— 「超级组是一整块」这个事实只在这里说一次。
 *
 * 为什么需要它:一个人练的时候总得临时改顺序(深蹲架被占了先做别的、今天想先把弱项练了)。
 * 计划和训练页都能改顺序,但一碰到超级组就得回答一个问题:**能不能把成员从组里拎出来?**
 * 两边答案不一样,这不是实现细节,是两种场景:
 *
 * - **训练中**(`moveWorkoutRow`):组内两个成员可以换(先做 A 还是先做 B 随你),
 *   但走到组的边缘就**带着整块越过去**,绝不把某个成员单独拎出来。
 *   一轮超级组往往正在进行中(做了 A 的第一组、还没做 B 的),这时把它拆开,
 *   这次训练前半段是超级组、后半段不是,同一份日志里两种语义混在一起。
 * - **计划里**(`movePlanItem`):一次一步,这一步把成员挪出了原来的相邻位置,
 *   超级组就**跟着解散**(它本来就是「相邻两个动作」配出来的)。计划还没开始练,
 *   拆开只是改主意;留着两个隔开的动作共用一个组号,只会让一个没有同伴的动作挂着「超级组」徽标。
 *
 * 两边的「组内换位」和「哪些行是一块」是同一条规则,所以块的划分(`orderUnits`)只有这一份实现。
 * 来源是 openGym 的 `lib/active-workout-order.js` + `lib/history.js`
 * (`supersetUnits` / `moveRoutineEntry` / `cleanupSg` 三条规则)。它那套「游标不能跨过」的判据
 * 刻意没有移植:BodyOS 是「随便点哪一组都能打勾」的自由顺序,没有轮转游标(见路线图 M10.9)。
 * 计划那边也和它有一处不同:它在边缘是**只解散不移动**(第一下先解绑,第二下才走),
 * BodyOS 的 ↑/↓ 是纯位置按钮、小程序里没有 hover 提示,按下不动会被当成坏了,
 * 所以这边是「按一下走一步,走开了就解散」——解散时页面会明确说一声。
 */

import type { TrainingPlan } from './types';

/** 参与排序的最小形状 —— 计划动作、训练组行都满足 */
export interface OrderRow {
  superset?: string;
}

export interface MoveResult<T> {
  /** 新顺序 */
  rows: T[];
  /** 被移动的那一行现在在第几位 */
  to: number;
  /** 新位置 → 旧位置(`order[新] = 旧`),调用方照它搬「按行号记着」的临时状态 */
  order: number[];
  /** 这一下解散了几个成员(计划里才可能 > 0;训练中恒为 0) */
  dissolved: number;
}

/**
 * 把行切成块:相邻且 `superset` 相同的连续行算一块,单独一行自己也成一块。
 * 注意是「和上一行相同」而不是「和任何一行相同」—— 隔开的两个动作即使带着同一个组号
 * 也不算一块(那是坏数据,交给 `cleanUnits` 收拾),显示语义就是相邻成组。
 */
export function orderUnits<T extends OrderRow>(rows: readonly T[]): number[][] {
  const units: number[][] = [];
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    if (i > 0 && row.superset && row.superset === prev?.superset) units[units.length - 1].push(i);
    else units.push([i]);
  });
  return units;
}

/** 这个下标所在的那一块(越界给空数组) */
export function unitOf(units: number[][], index: number): number[] {
  return units.find((u) => u.includes(index)) ?? [];
}

/** 这一行是不是「和同伴绑在一起」的超级组成员(界面用它说明「整组一起走」) */
export function inUnit(rows: readonly OrderRow[], index: number): boolean {
  return unitOf(orderUnits(rows), index).length > 1;
}

/** 去掉组号 —— 不原地改传入的行 */
function unpaired<T extends OrderRow>(row: T): T {
  const next = { ...row };
  delete next.superset;
  return next;
}

/**
 * 解散落单的超级组:块里只剩一个成员、而它身上还挂着组号的行,把组号摘掉。
 * 这种坏数据有三个来源:旧的调序会把成员和同伴分开、删掉同伴会留下孤儿组号、
 * 换动作建新行时忘了把组号带过来。留着它们只会让一个没有同伴的动作挂着「超级组」徽标。
 * 没有可摘的组号时**返回原数组**(同一个引用)—— 页面靠它判断要不要重渲染。
 */
export function cleanUnits<T extends OrderRow>(rows: readonly T[]): readonly T[] {
  const lone = orderUnits(rows).filter((u) => u.length < 2).map((u) => u[0]);
  if (!lone.some((i) => rows[i].superset)) return rows;
  const drop = new Set(lone);
  return rows.map((row, i) => (drop.has(i) && row.superset ? unpaired(row) : row));
}

/**
 * 整份计划里解散落单的超级组(读计划时跑一次 —— 本机存着的老计划可能是旧的调序弄坏的)。
 * 没变化时返回原对象,不制造无谓的新引用。
 */
export function cleanPlanUnits(plan: TrainingPlan): TrainingPlan {
  let changed = false;
  const days = plan.days.map((day) => {
    const items = cleanUnits(day.items);
    if (items === day.items) return day;
    changed = true;
    return { ...day, items: items as typeof day.items };
  });
  return changed ? { ...plan, days } : plan;
}

/** 换位:按老下标给新顺序 + 新位置→旧位置 的置换 */
function permute<T>(rows: readonly T[], order: number[]): T[] {
  return order.map((i) => rows[i]);
}

/**
 * 核心一步。`keepUnit` 决定走到块的边缘时是「整块过」还是「走一步、走开了就解散」。
 * 组内换位(两个成员互换)两边一样 —— 那不会破坏块本身。
 */
function step<T extends OrderRow>(
  rows: readonly T[],
  index: number,
  dir: number,
  keepUnit: boolean
): MoveResult<T> | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null;
  if (dir !== -1 && dir !== 1) return null;

  const units = orderUnits(rows);
  const source = units.findIndex((u) => u.includes(index));
  if (source < 0) return null;
  const unit = units[source];
  const neighbour = index + dir;

  // 组内换位:块的位置不动,两个成员换个位置(超级组照样是这些动作)
  if (unit.length > 1 && unit.includes(neighbour)) {
    const order = rows.map((_, i) => i);
    order[index] = neighbour;
    order[neighbour] = index;
    return { rows: permute(rows, order), to: neighbour, order, dissolved: 0 };
  }

  const target = source + dir;
  if (target < 0 || target >= units.length) return null;

  if (keepUnit) {
    // 整块越过邻近那一块(块内顺序不动),成员因此永远不会和同伴分开
    const reordered = [...units];
    reordered[source] = units[target];
    reordered[target] = unit;
    const order = reordered.flat();
    return { rows: permute(rows, order), to: order.indexOf(index), order, dissolved: 0 };
  }

  // 一次一步:和邻居换位,换完把走开的超级组解散掉
  const order = rows.map((_, i) => i);
  order[index] = neighbour;
  order[neighbour] = index;
  const moved = permute(rows, order);
  const cleaned = cleanUnits(moved) as T[];
  // 只报「原本真的成组、这一下被拆了」的成员。陈年的孤儿组号被顺带摘掉不算 ——
  // 那种组在界面上从没出现过,报出来就成了凭空的「超级组已解除」。
  const wasPaired = new Set(orderUnits(rows).filter((u) => u.length > 1).flat());
  const dissolved = moved.reduce(
    (n, row, i) => n + (row.superset && wasPaired.has(order[i]) && !cleaned[i].superset ? 1 : 0),
    0
  );
  return { rows: cleaned, to: neighbour, order, dissolved };
}

/** 训练中能不能往这个方向移(按钮的禁用态用,不建数组) */
export function canMoveWorkoutRow<T extends OrderRow>(rows: readonly T[], index: number, dir: number): boolean {
  const units = orderUnits(rows);
  const source = units.findIndex((u) => u.includes(index));
  if (source < 0 || (dir !== -1 && dir !== 1)) return false;
  const unit = units[source];
  if (unit.length > 1 && unit.includes(index + dir)) return true;
  const target = source + dir;
  return target >= 0 && target < units.length;
}

/** 训练中上移/下移:组内换位,到边缘带着整块走(见文件头) */
export function moveWorkoutRow<T extends OrderRow>(rows: readonly T[], index: number, dir: number): MoveResult<T> | null {
  return step(rows, index, dir, true);
}

/**
 * 训练中插一行 —— 加练一个动作(计划里没有、今天想顺手做一组的那种)。
 *
 * 插的位置是**这一行所在的那一块之后**,不是这一行的后面:插在超级组成员中间会把那一块劈成两半,
 * 而两个隔开的成员各挂一个组号,正是上面 `cleanUnits` 要收拾的坏数据。
 *
 * 返回的 `order` 与 `moveWorkoutRow` 同一个约定(新位置 → 旧位置)。插进来的那一行没有旧位置,
 * 占位 -1:页面按旧行号查表搬那些「按行号记着」的临时状态(warmDone/doneOpen/focus…),
 * 查不到的正好就是它 —— 它本来就是全新的,没有任何状态要搬。
 */
export function insertWorkoutRow<T extends OrderRow>(
  rows: readonly T[],
  index: number,
  row: T
): { rows: T[]; order: number[] } | null {
  if (!Array.isArray(rows)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null;
  const unit = unitOf(orderUnits(rows), index);
  const at = (unit.length ? unit[unit.length - 1] : index) + 1;
  const order = rows.map((_, i) => i);
  order.splice(at, 0, -1);
  return { rows: [...rows.slice(0, at), row, ...rows.slice(at)], order };
}

/** 计划里上移/下移:一次一步,走开了就解散(见文件头) */
export function movePlanItem<T extends OrderRow>(items: readonly T[], index: number, dir: number): MoveResult<T> | null {
  return step(items, index, dir, false);
}
