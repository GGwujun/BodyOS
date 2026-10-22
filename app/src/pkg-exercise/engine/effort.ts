import { THEME } from '../../constants/theme';
/**
 * 自感强度(RIR = Reps In Reserve,还能再做几次)。
 *
 * 内部统一用 RIR 记账,因为它有真实的零点(0 = 力竭),而 RPE 的 6 分下限只是"值不值得记"的
 * 约定。RPE 8 == RIR 2。对大众用户来说"还能再做几次"比"自觉用力程度 8 分"好懂得多,
 * 所以 BodyOS 只暴露 RIR 一档刻度。
 *
 * 色带从"力竭"(紫,越过红)一路到"轻松"(灰绿),一眼扫过去就知道这次练得狠不狠。
 * 命名档位同时是快捷选择项:靠近力竭处分得细(0/1/2/3 之差真的改变训练),超过 3 次合并成
 * 一档("还能做很多次"),因为没人能可靠分辨 5 次和 7 次。
 */

export interface EffortBand {
  /** 该档位的值(preset 点它记这个数) */
  rir: number;
  /** 落在这个值以下的读数归本档 */
  max: number;
  color: string;
  /** 档位短标签(选择器上显示) */
  label: string;
  /** 人话解释(选择器副标题/详情) */
  feel: string;
}

export const EFFORT_BANDS: EffortBand[] = [
  { rir: 0, max: 0.5, color: THEME.plum, label: '力竭', feel: '一个都做不动了' },
  { rir: 1, max: 1.5, color: THEME.danger, label: '剩 1 次', feel: '大概还能做 1 次' },
  { rir: 2, max: 2.5, color: THEME.warning, label: '剩 2 次', feel: '还能做 2 次' },
  { rir: 3, max: 3.5, color: THEME.primary, label: '剩 3 次', feel: '还能做 3 次,刚刚好' },
  { rir: 4, max: Infinity, color: THEME.muted, label: '很轻松', feel: '还能做很多次,可以加重' }
];

/** 选择器上按顺序展示的档位(力竭在前,和色带方向一致) */
export const EFFORT_PRESETS = EFFORT_BANDS;

/** 达标线:在这个值以内算"有效组",是驱动进步的那类。3 而非 2 是惯例取整。 */
export const HARD_RIR = 3;

/** 少于这个数的已评组数不显示平均值("平均 RIR 1.0" 只来自一组,读起来像结论其实是一次点击) */
export const MIN_RATED = 5;

/** 一个 RIR 读数落在哪一档 */
export const bandOf = (rir: number | null | undefined): EffortBand | null => {
  if (rir == null || Number.isNaN(rir)) return null;
  for (const b of EFFORT_BANDS) if (rir <= b.max) return b;
  return EFFORT_BANDS[EFFORT_BANDS.length - 1];
};

/**
 * 一个读数落在第几档(下标对应 EFFORT_BANDS);未评为 -1。
 * 统计页的强度分布条要的是「每一档多少组」而不是「这一档叫什么」,
 * 档位的边界只在 EFFORT_BANDS 里定义一次,所以这里也让 `bandOf` 说了算 ——
 * 页面自己按 `rir <= 2.5` 之类写一遍,改刻度的时候就会漏改一处。
 */
export const bandIndex = (rir: number | null | undefined): number =>
  rir == null || Number.isNaN(rir) ? -1 : EFFORT_BANDS.indexOf(bandOf(rir) as EffortBand);

/** 读数 → 颜色;未评为 null(调用方显示中性控件,而不是默认绿色) */
export const effortColor = (rir: number | null | undefined): string | null => bandOf(rir)?.color ?? null;

/** 读数 → 短标签;未评为空串 */
export const effortLabel = (rir: number | null | undefined): string => bandOf(rir)?.label ?? '';

/** 人话解释;未评为空串 */
export const effortFeel = (rir: number | null | undefined): string => bandOf(rir)?.feel ?? '';

/** 是否属于"有效组"(接近力竭) */
export const isHardSet = (rir: number | null | undefined): boolean => rir != null && rir <= HARD_RIR;

/**
 * 「只看有效组」这个读法至少要有的评分覆盖率。
 *
 * 为什么要这条:有效组是**从评过分的组里**数出来的,没评的那些组进不来。
 * 只评了三分之一就切过去,合计凭空少一大截,而用户读到的是「我这周练得比上周少」——
 * 按全部组看是虚高,按有效组看是虚低,两个都不对,那就先别让他切。
 * 一半不是算出来的,是「宁可先不给,也别给一个会被读错的数」。
 */
export const HARD_COVERAGE = 0.5;

/**
 * 这段时间评过强度的组够不够按有效组看(肌群页「组数怎么算」的那个门槛)。
 * ①绝对量沿用统计页强度卡的 MIN_RATED —— 同一条「评过 5 组」在两页上是同一个意思;
 * ②占比:评过的要占一半以上,理由见 HARD_COVERAGE。
 *
 * 统计页那一块**不**需要这条:它的分母本来就是评过分的组,评得少只是样本少,
 * 比例不会算错;肌群页是按「全部组」的窗口在数,才需要先问一句够不够。
 */
export function canFilterHard(st: { sets: number; rated: number }): boolean {
  return st.rated >= MIN_RATED && st.rated >= st.sets * HARD_COVERAGE;
}

/** 一组读数的平均强度;没有读数返回 null(不把未评的组算成 0) */
export const avgRir = (reads: (number | null | undefined)[]): number | null => {
  const vs = reads.filter((v): v is number => v != null);
  if (!vs.length) return null;
  return Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10;
};

/** 平均读数 → 一句评价(用于训练完成汇总) */
export function effortVerdict(avg: number | null): string {
  if (avg == null) return '';
  if (avg <= 0.5) return '几乎组组力竭,强度很高,注意恢复';
  if (avg <= 1.5) return '大部分组接近力竭,刺激到位';
  if (avg <= 2.5) return '留有余量的训练,适合长期稳定进步';
  return '整体偏轻松,下次可以适当加重或加次数';
}
