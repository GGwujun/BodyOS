/**
 * 超级组的「轮」— 把块内交替的进度翻译成人能看懂的一句。
 *
 * 模型(types.ts `superset`):同 id 的**相邻**行成一块,一轮 = 块内每个动作各做一组,
 * 做到块内最后一个动作的那组才休息(workout 的 `toggleSet` 里那条「同伴同序号没做 → 接着做」)。
 * 这件事引擎一直都会算,但界面上只有勾完那一下的一句 toast —— 练到一半「这轮做完该换哪个」
 * 全靠用户自己记。这里补的是**常驻**的那句:第几轮 / 一共几轮 / 下一个是哪个动作。
 *
 * 纯数据进出(只依赖 superset 和 sets[].done 两个形状),页面传 rows、计划校验也传得了。
 */

/** 页面行/计划项都满足的最小形状(结构化:不 import Row,免得把页面类型拽进纯模块) */
export interface FlowRow {
  superset?: string;
  sets: ReadonlyArray<{ done: boolean }>;
}

export interface SupersetFlow {
  /** 当前进行到第几轮(1 起) */
  round: number;
  /** 一共几轮 = 块内最大的组数(「＋ 加一组」可能只加在其中一个动作上) */
  totalRounds: number;
  /** 下一步该做块内第几行;全做完为 null */
  nextRi: number | null;
  /** 下一步是那一行的第几组(0 起);nextRi 为 null 时无意义 */
  nextSi: number | null;
}

/**
 * ri 所在的超级组块(相邻且同 id 的连续行号,按行序返回)。
 * 不在超级组里、或同伴被移走只剩自己 → 空数组;调用方拿空数组就别渲染流程条。
 */
export function blockOf<T extends FlowRow>(rows: readonly T[], ri: number): number[] {
  const id = rows[ri]?.superset;
  if (!id) return [];
  const out: number[] = [ri];
  for (let i = ri - 1; i >= 0 && rows[i].superset === id; i--) out.unshift(i);
  for (let i = ri + 1; i < rows.length && rows[i].superset === id; i++) out.push(i);
  return out;
}

/**
 * 块的下一步 —— 按「第几组 × 块内行序」把交替模拟一遍,撞到第一个没打勾的就是下一步。
 * 这是勾组那一刻 `toggleSet` 找同伴那条规则的同一套序,只是它问「同伴做没做」,
 * 这里问「从头到尾第一个没做的是哪步」—— 两处必须是同一个走法,否则流程条说的
 * 和 toast 说的会不是同一个动作。
 *
 * 单行成块(解组后残留、或计划本来就是单动作配了 superset 字段)返回 null:
 * 没有交替就没有「轮」,那行按普通动作显示。
 */
export function flowOf<T extends FlowRow>(rows: readonly T[], ri: number): SupersetFlow | null {
  const block = blockOf(rows, ri);
  if (block.length < 2) return null;
  const totalRounds = Math.max(...block.map((i) => rows[i].sets.length));
  for (let si = 0; si < totalRounds; si++) {
    for (const bi of block) {
      const s = rows[bi].sets[si];
      if (s && !s.done) return { round: si + 1, totalRounds, nextRi: bi, nextSi: si };
    }
  }
  // 一组不剩:轮数停在总轮数上,「全部做完」由调用方按 nextRi == null 说
  return { round: totalRounds, totalRounds, nextRi: null, nextSi: null };
}
