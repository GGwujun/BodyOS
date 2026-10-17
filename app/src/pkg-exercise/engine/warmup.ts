/**
 * 热身组生成 — 按正式组重量推导递增热身组。
 * 热身组不计入训练容量、不参与渐进判断,只用来「把重量试上去 + 唤醒动作模式」。
 */

export interface WarmupSet {
  weightKg: number;
  reps: number;
  /** 占正式组的百分比(展示用) */
  pct: number;
}

/** 重量档位:小重量少热身、大重量热身阶梯更完整 */
const LADDER: { maxWork: number; table: [number, number][] }[] = [
  { maxWork: 30, table: [[0.5, 8]] },
  { maxWork: 60, table: [[0.4, 8], [0.65, 5]] },
  { maxWork: Infinity, table: [[0.4, 8], [0.6, 5], [0.8, 3]] }
];

/**
 * 正式重量 → 热身组。自重动作(workWeightKg 为 null)返回空
 * ——徒手不需要配重热身,活动关节即可。
 * @param step 该动作的最小加重单位,热身重量会对齐到它(器械上不出现 37.5 这种配不出的重量)
 * @param sided 单侧动作 —— 表里的次数是按「每侧几下」写的(热身就是把动作模式顺一遍),
 *   合计口径下要翻倍;不翻的话显示出来就是「每侧 2.5 次」这种没法执行的数
 */
export function warmupSets(workWeightKg: number | null, step = 2.5, maxSets = 3, sided = false): WarmupSet[] {
  if (workWeightKg == null || workWeightKg <= 0) return [];
  const unit = step > 0 ? step : 2.5;
  const snap = (w: number) => Math.max(unit, Math.round(w / unit) * unit);
  const table = (LADDER.find((l) => workWeightKg < l.maxWork) ?? LADDER[LADDER.length - 1]).table;

  const out: WarmupSet[] = [];
  for (const [p, reps] of table.slice(0, maxSets)) {
    const w = snap(workWeightKg * p);
    if (w >= workWeightKg) break;              // 不允许热身上到正式重量
    if (out.length && w <= out[out.length - 1].weightKg) continue; // 必须严格递增
    out.push({ weightKg: w, reps: sided ? reps * 2 : reps, pct: Math.round(p * 100) });
  }
  return out;
}

/** 一句话热身提示(正式重量未知时的兜底文案) */
export function warmupHint(count: number): string {
  if (count <= 0) return '先做 5 分钟动态活动,把关节打开再开始';
  return `先用 ${count} 组递增重量热身,每组之间不急着上,动作顺了再上正式重量`;
}
