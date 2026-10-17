/**
 * 三大营养素的口径 —— 蛋白/碳水/脂肪怎么加、怎么说,只写在这一个文件里。
 *
 * 为什么现在才有:每顿饭记进去的时候就是带克数的(食物库里就有,服务端按天汇总进了
 * DailySummary.nutrition),但从记录页到趋势页**没有一处显示过它们**。
 * 于是用户记了两个月,只知道自己「今天吃了 1800 千卡」——
 * 而真正该问的是「蛋白够不够、油是不是放多了」,热量一个数答不了。
 * 这和趋势页原来只画热量不画训练是同一类问题:接口给了,没人用。
 *
 * 两条口径写死在这里,不许各页自己算:
 *
 * 1. **日均只除以有记录的天数。** 没记的那天克数是 0,把它算进均数等于替用户记了一天
 *    「什么都没吃」,均数会被摊薄到没有意义 —— 热量那块早就是这么算的(见 trend 页),
 *    营养素必须跟着同一套,否则同一张卡上两个均数各按各的分母。
 *
 * 2. **占比按热量算,不按克数。** 脂肪 1 克是碳水的 2.25 倍热量(9 : 4),
 *    按克数比会把「油放多了」说得很轻 —— 一勺油才 10 克,却是 90 千卡。
 */

export interface Macros {
  proteinG: number;
  carbG: number;
  fatG: number;
}

/** 每克供能(千卡)。4 / 4 / 9 是通行的换算,营养标签也是这么算的 */
export const KCAL_PER_G: Record<keyof Macros, number> = { proteinG: 4, carbG: 4, fatG: 9 };

export const ZERO_MACROS: Macros = { proteinG: 0, carbG: 0, fatG: 0 };

/** 取一个数,不是有限数就当 0 —— 接口的 Json 字段老记录里可能缺 */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** 随便什么形状的一行(接口行、日志里的 items)收成一个 Macros */
export function macrosOf(raw: unknown): Macros {
  const o = (raw ?? {}) as Record<string, unknown>;
  return { proteinG: num(o.proteinG), carbG: num(o.carbG), fatG: num(o.fatG) };
}

export function sumMacros(rows: unknown[]): Macros {
  return rows.reduce<Macros>((acc, row) => {
    const m = macrosOf(row);
    return { proteinG: acc.proteinG + m.proteinG, carbG: acc.carbG + m.carbG, fatG: acc.fatG + m.fatG };
  }, { ...ZERO_MACROS });
}

/**
 * 日均。`days` 是**有记录的天数**,不是窗口天数 —— 见文件头第 1 条。
 * days <= 0 返回 null:没有记录的时候「日均 0 克蛋白」是句假话,该说的是「还没有记录」。
 */
export function avgMacros(rows: unknown[], days: number): Macros | null {
  if (days <= 0) return null;
  const sum = sumMacros(rows);
  return {
    proteinG: sum.proteinG / days,
    carbG: sum.carbG / days,
    fatG: sum.fatG / days
  };
}

/**
 * 这几天里**至少有一条真的带克数**吗。
 *
 * 手动记的那一条(只填名字和热量)三个克数都是 0。如果一整天都这么记,
 * 加出来就是「蛋白 0g · 碳水 0g · 脂肪 0g」—— 看着像用户一口蛋白质都没吃,
 * 其实只是没记克数。这种情况宁可不显示营养素,也不显示一份假的 0。
 */
export function anyMacros(rows: unknown[]): boolean {
  return rows.some((row) => {
    const m = macrosOf(row);
    return m.proteinG > 0 || m.carbG > 0 || m.fatG > 0;
  });
}

export interface MacroShare {
  proteinG: number;
  carbG: number;
  fatG: number;
}

/**
 * 供能占比(整数百分比,**合计一定 100**)。三样都是 0 时返回 null —— 没有分母。
 *
 * 「一定 100」是条子决定的:那条占比条是把三段宽度直接当百分比铺满的,
 * 三项各自四舍五入会凑出 99 或 101 —— 99 会留一道缝,101 会把最后一段挤出容器。
 * 所以先各自向下取整,再把差出来的那几点按**小数部分从大到小**补给谁
 * (最大余额法):既保证铺满,又让补掉的那一点落在最该进位的段上。
 * 直接把余数塞给脂肪那种写法不行 —— 它会让脂肪每次都占那几十个百分点里的一点小便宜。
 */
export function energyShare(m: Macros): MacroShare | null {
  const raw = [
    Math.max(0, m.proteinG) * KCAL_PER_G.proteinG,
    Math.max(0, m.carbG) * KCAL_PER_G.carbG,
    Math.max(0, m.fatG) * KCAL_PER_G.fatG
  ];
  const total = raw[0] + raw[1] + raw[2];
  if (total <= 0) return null;

  const pct = raw.map((v) => (v / total) * 100);
  const out = pct.map(Math.floor);
  // 谁的小数部分大谁先补;一样大时按 蛋白 → 碳水 → 脂肪 的顺序(稳定,不抖)
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = pct
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return { proteinG: out[0], carbG: out[1], fatG: out[2] };
}

const r0 = (v: number) => Math.round(v);

/** '蛋白 82g · 碳水 210g · 脂肪 52g'(克数,取整到个位) */
export function macroLine(m: Macros): string {
  return `蛋白 ${r0(m.proteinG)}g · 碳水 ${r0(m.carbG)}g · 脂肪 ${r0(m.fatG)}g`;
}

/** '蛋白 18% · 碳水 52% · 脂肪 30%'(供能占比) */
export function shareLine(s: MacroShare): string {
  return `蛋白 ${s.proteinG}% · 碳水 ${s.carbG}% · 脂肪 ${s.fatG}%`;
}

/**
 * 日均蛋白离**引擎给的目标**还差多少克(够了、或差得不多就返回 null)。
 *
 * 目标不在客户端算。蛋白该吃多少取决于体重和目标类型(减脂期反而要更高,
 * 见服务端 engine/constants.PROTEIN_PER_KG),那套公式已经在引擎里了 ——
 * 客户端再写一份「1.2~1.6 克/公斤」,今天看着差不多,改天引擎调了系数就悄悄分叉,
 * 而且用户会在两页上看到两个目标。所以 target 由服务端随趋势一起返回(见 trends 路由)。
 *
 * 差 5 克不值得一提(一杯牛奶的事),拿它去提示用户是在制造噪音;差 10 克以上才说一句。
 * 没有目标、或者本来就没记录,一样返回 null。
 */
export const PROTEIN_SHORT_MIN = 10;

export function proteinShortBy(avg: Macros | null, target: { proteinG: number } | null): number | null {
  if (!target || target.proteinG <= 0 || !avg || avg.proteinG <= 0) return null;
  const gap = r0(target.proteinG - avg.proteinG);
  return gap >= PROTEIN_SHORT_MIN ? gap : null;
}
