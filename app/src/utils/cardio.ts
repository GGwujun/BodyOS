/**
 * 有氧的距离 / 配速 / 坡度 —— 纯函数,不发请求、不碰存储。
 *
 * **口径来自 openGym 的有氧组**:它每条有氧记录存 `{min, speed(km/h), incline(%)}` ——
 * 跑步机上的三件套。BodyOS 存 `{时长, 距离(米), 坡度(%)}`:距离和「速度」是同一件事
 * (速度 = 距离 ÷ 时长),但存距离能同时接住户外跑的人(他手里是公里数,不是速度),
 * 跑步机的人也可以先按速度反推。**速度/配速一律算出来,不存** —— 同一件事存两份,
 * 迟早出现「配速显示 6'00" 但 30 分钟 5 公里」的自相矛盾。
 *
 * 另一条:**算不出来就什么都不显示**。缺时长、缺距离、或者算出来是个不可能是人跑出来的数
 * (0.1 公里练了 2 小时),一律返回 null,让界面少一行,而不是显示一个荒唐的值。
 */

/** 一项运动的距离口径:跑步按配速、骑行按速度、游泳按百米配速 */
export interface CardioSpec {
  /** pace = 每单位用时(跑步/游泳),speed = 每小时多少公里(骑行) */
  kind: 'pace' | 'speed';
  /** 一个计量单位是多少米 */
  per: number;
  unit: '公里' | '100 米';
}

const SPECS: Record<string, CardioSpec> = {
  跑步: { kind: 'pace', per: 1000, unit: '公里' },
  快走: { kind: 'pace', per: 1000, unit: '公里' },
  徒步: { kind: 'pace', per: 1000, unit: '公里' },
  游泳: { kind: 'pace', per: 100, unit: '100 米' },
  骑行: { kind: 'speed', per: 1000, unit: '公里' }
};

/** 这项运动要不要问距离/配速;返回 null 就是不用问(力量、瑜伽、球类…) */
export function cardioOf(type: string): CardioSpec | null {
  return SPECS[type] ?? null;
}

/** 距离上限 500 公里 —— 挡掉「把体重填进距离」这类手滑 */
export const MAX_DISTANCE_M = 500_000;
/** 坡度上限 40%(和 openGym 一致;跑步机最高一般也就 15%,留足余量) */
export const MAX_INCLINE_PCT = 40;
/** 坡度步进 0.5% —— 跑步机的坡度键就是半格半格按的 */
export const INCLINE_STEP = 0.5;

/**
 * 用户填的「公里」文本 → 米(整数)。
 * 认 '5'、'5.2'、'5,2'(中文输入法逗号)、'5.2公里'、'5.2km';认不出来返回 null。
 */
export function parseDistanceKm(input: string): number | null {
  const raw = (input || '').trim().replace(/[，,]/g, '.').replace(/\s*(公里|千米|km|KM|Km)$/, '');
  if (!raw) return null;
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(raw)) return null;
  const km = Number(raw);
  if (!Number.isFinite(km) || km <= 0) return null;
  const m = Math.round(km * 1000);
  return m > MAX_DISTANCE_M ? null : m;
}

/** 米 → 人话。不到 1 公里说米(跑者说「今天跑了 800」,不会说 0.8 公里) */
export function distanceText(m?: number | null): string {
  if (m == null || !Number.isFinite(m) || m <= 0) return '';
  if (m < 1000) return `${Math.round(m)} 米`;
  const km = m / 1000;
  // 一位小数够用:10.04 和 10.0 对跑者没区别,但「10.04 公里」显得像仪表盘
  return `${km >= 100 ? km.toFixed(0) : km.toFixed(1)} 公里`;
}

/** 每单位用时(秒)。算不出来(缺时长/缺距离)或不像人干的,返回 null */
export function paceSeconds(durationMin?: number | null, distanceM?: number | null, per = 1000): number | null {
  if (durationMin == null || distanceM == null) return null;
  if (!Number.isFinite(durationMin) || !Number.isFinite(distanceM)) return null;
  if (durationMin <= 0 || distanceM <= 0 || per <= 0) return null;
  const sec = (durationMin * 60 * per) / distanceM;
  // 合理区间:每公里 2 分钟(世界纪录)到 60 分钟(慢走);百米 45 秒到 30 分钟(泡在水里)
  const [lo, hi] = per >= 1000 ? [120, 3600] : [45, 1800];
  if (sec < lo || sec > hi) return null;
  return sec;
}

/** 秒 → `5'42"`;整分钟写成 `6'00"`,不缩成 `6'`(一列里格式要统一) */
export function mmss(sec: number): string {
  const s = Math.round(sec);
  const min = Math.floor(s / 60);
  return `${min}'${String(s % 60).padStart(2, '0')}"`;
}

/**
 * 配速 / 速度的人话。
 * 跑步 →「5'42"/公里」;游泳 →「2'05"/100 米」;骑行 →「20.5 公里/小时」。
 * 运动类型没有距离口径、或数字算不出来 → 空字符串。
 */
export function paceText(type: string, durationMin?: number | null, distanceM?: number | null): string {
  const spec = cardioOf(type);
  if (!spec || distanceM == null || distanceM <= 0) return '';
  const sec = paceSeconds(durationMin, distanceM, spec.per);
  if (sec == null) return '';
  if (spec.kind === 'speed') return `${(3600 / sec).toFixed(1)} 公里/小时`;
  return `${mmss(sec)}/${spec.unit}`;
}

/** 坡度:`6%`。0 和空都不说 —— 平地上不用特意交代「坡度 0%」 */
export function inclineText(pct?: number | null): string {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return '';
  return `坡度 ${Number(pct.toFixed(1))}%`;
}

/** 用户填的坡度文本 → 0.5 一格;不填/填 0 → null(平地不存 0,省得每次都要判断) */
export function parseIncline(input: string): number | null {
  // 只脱**一个**结尾的百分号:'6%' 是正常人打的,'6%%' 是打错了
  const raw = (input || '').trim().replace(/[．，,]/g, '.').replace(/[%％]$/, '').trim();
  if (!raw) return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_INCLINE_PCT) return null;
  // 落不到半格就往上靠一格:跑步机没有 6.3% 这一档
  return Math.round(n / INCLINE_STEP) * INCLINE_STEP;
}

/**
 * 一条有氧记录第二行要显示的东西?——没有就返回空串,界面跳过这一行。
 *
 * 距离也要按类型过一道:`distanceText` 本身不认运动类型,而库里可能躺着带距离的
 * 力量训练记录(早前的解析、或者用户改了运动类型)。给瑜伽显示「5.2 公里 · 无配速」
 * 比不上任何一行都别显示 —— 说不通的东西宁可不显示。
 */
export function cardioSubText(
  type: string,
  durationMin?: number | null,
  distanceM?: number | null,
  inclinePct?: number | null
): string {
  const spec = cardioOf(type);
  if (!spec) return '';
  return [distanceText(distanceM), paceText(type, durationMin, distanceM), inclineText(inclinePct)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * 距离 → 估算消耗(kcal),按体重和运动类型的 MET 值。
 * 只在**用户自己没填消耗**时兜底:填了就以用户为准(设备测的比公式准,公式只是防止空着)。
 * 缺体重时退回按 65kg 算,并在 UI 上说明是估算。
 */
const MET: Record<string, number> = {
  跑步: 9.8, 快走: 4.3, 徒步: 6.0, 骑行: 7.5, 游泳: 7.0,
  /**
   * 力量训练 3.5 —— 通用抗阻训练的教科书取值。它明显低于上面几项,不是写错了:
   * 这一档算的是**含组间休息**的那一小时,不是连续做功。真实区间在 3.5-6 之间
   * (取决于组间歇多久、用的是复合动作还是单关节),取低值是因为估高了会让人
   * 当天多吃;估低了只是保守。同一个口径也用在训练模块回写的记录上(见
   * pkg-exercise/engine/workout-energy.ts),两处必须一致。
   */
  力量训练: 3.5
};
const DEFAULT_WEIGHT = 65;

export function estimateCalories(type: string, durationMin: number, weightKg?: number | null): number | null {
  const met = MET[type];
  if (!met || !Number.isFinite(durationMin) || durationMin <= 0) return null;
  const kg = weightKg != null && weightKg > 0 ? weightKg : DEFAULT_WEIGHT;
  return Math.round((met * 3.5 * kg * durationMin) / 200);
}
