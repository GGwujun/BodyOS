/**
 * 折线图的**判据** —— 纵轴画到哪、刻度上写什么、手指点在第几个点上。
 *
 * 为什么要有这一层:这三件事以前和「画」糊在一起写在 `components/LineChart` 里,
 * 于是全站的曲线只有一种样子 —— 没有刻度、点不动、目标线画不进来。要改就得改那个组件,
 * 而组件是**渲染**,进不了冒烟测试。判据挪出来之后,曲线怎么读得靠得住就测得住:
 * 「目标 60 公斤时纵轴得把 60 包进来」「点在两头之外算头尾那一点」这些都能钉。
 *
 * 三条口径,**改之前先读**:
 *  · 纵轴两端要**向外取整到好看的刻度**(64.0 / 66.0 / 68.0,而不是 64.2 / 68.9):
 *    刻度是给人念的,不是给算法看的。顺带把曲线从边框上挪开一点(峰谷贴着边看不出来是峰还是边)。
 *  · **目标线画不进来等于没画**:所以算域的时候目标值参与进来(它可以在数据范围之外,
 *    比如体重一路在 70 上下、目标是 65 —— 那条线恰恰是最该看见的)。
 *  · 点选按**最近的那个点**算,无论手指落在留白里还是图外:图上的点本来就稀(7 天 7 个),
 *    一个点负责它左右各半格的宽度,点哪儿都有读数,不用精确戳中那个 2.5px 的圆。
 */

/** 纵轴的范围与步长:`min`/`max` 落在 `step` 的整数倍上 */
export interface ChartDomain {
  min: number;
  max: number;
  step: number;
}

/**
 * 1 / 2 / 5 × 10ⁿ 里**不超过**它的那个步长(刻度只会是 0.5、2、5、100 这种数)。
 * 取「不超过」而不是「最接近」:`chartDomain` 拿它当「一段多宽」用,取大了段数就少、
 * 上下留白就多(6.3 的范围按 5 走,曲线只占中间那半截),取小一点只是刻度密一点。
 */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const m = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return m * mag;
}

/** 按步长取整(浮点小数位跟着步长走,免得 0.1 的倍数算出 64.30000000000001) */
function roundTo(v: number, step: number): number {
  const dp = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)) + 1));
  return Number((Math.round(v / step) * step).toFixed(dp));
}

/**
 * 纵轴范围。空数据给 0~1(画不出来,但调用方不该拿到 NaN 去 `toFixed`)。
 *
 * 目标值参与算域(见文件头第二条);一个值的序列(只有一次记录)左右各撑 1,否则
 * `min === max` 会让整条曲线除零、画到边框外。
 */
export function chartDomain(values: number[], target?: number | null): ChartDomain {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 1, step: 1 };
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  if (target != null && Number.isFinite(target)) {
    lo = Math.min(lo, target);
    hi = Math.max(hi, target);
  }
  if (lo === hi) { lo -= 1; hi += 1; }
  /* 分三段:上下各一格留白,曲线不贴边框 */
  const step = niceStep((hi - lo) / 3);
  return { min: roundTo(Math.floor(lo / step) * step, step), max: roundTo(Math.ceil(hi / step) * step, step), step };
}

/**
 * 这条目标线到底该不该画。
 *
 * `chartDomain` 让目标参与算域,是为了「一路 70 公斤、目标 65」这种曲线 —— 但在图上把
 * 65 和 71 摆进同一根纵轴,那条 65 的线会把曲线本身压平:用户一个月掉的 0.5 公斤,
 * 在「目标还差 6 公斤」的高度里连一个像素都不到,而他要看的恰恰是那 0.5。
 * 所以划一条界线:**目标让纵轴跨度涨不过原来两倍,才画**。过了就不画 ——
 * 那时候「离目标多远」是进度环和上面那排数字回答的,不是曲线该回答的。
 *
 * 目标太远 = 返回 false,调用方(曲线组件)既不画线也不让它参与算域。
 */
export function worthTarget(values: number[], target?: number | null): boolean {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length || target == null || !Number.isFinite(target)) return false;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  /* 序列只有一个值(或全都一样)时,基准用 1:那点上下各一格,目标挨得够近才画 */
  const span = hi - lo || 1;
  return Math.max(hi, target) - Math.min(lo, target) <= span * 2 + 1e-9;
}

/**
 * 手指点在第几个点上(按最近的算,两头之外按头尾)。
 *
 * `left` 是绘图区左边距(纵轴刻度占了那一条),`width` 是绘图区宽度。
 * 点数 ≤ 1 或宽度算不出来时一律回 0 —— 单点图上没有「第几个」这回事。
 */
export function pickIndex(x: number, left: number, width: number, count: number): number {
  if (count <= 1 || !(width > 0)) return 0;
  const step = width / (count - 1);
  const i = Math.round((x - left) / step);
  return Math.min(count - 1, Math.max(0, i));
}

/**
 * 刻度上的数字。小数位跟着步长走:步长 0.5 念一位(65.5),步长 2 就不念小数(64)。
 * 上万折成「1.2万」—— 步数曲线的刻度写「12000」在手机的边距里放不下。
 */
export function axisText(v: number, step: number): string {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}万`;
  const dp = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(dp);
}

/** 读数上的数字:整数就不带小数点(8000 步,不是 8000.0 步),小数留一位(65.2 公斤) */
export function valueText(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
