/**
 * 时长口径 —— 组间休息、训练计时、单堂时长的**唯一**念法。
 *
 * 为什么要有这一层:休息时间在页面里到处都是(计划里的处方、训练页的倒计时条、
 * 专注模式的大计时、完成页的时长统计、分享卡),而它天生有两种读法 ——
 * 用户嘴上说的是「休息一分半」「休息三分钟」,系统里存的却是 `restSec: 90` / `180`。
 * 各写各的转换就会出现:计划里写「休息 150s」、训练页上写「2:30」、完成页写「2 分钟」——
 * 同一个数字三种长相,而且 **150 秒这种数没人能在脑子里换算**。
 *
 * 两条口径,按用途分,不按页面分:
 *  · `fmtDuration` —— **秒级**(休息处方、休息倒计时、训练计时):「45s」/「1:30」/
 *    「1:05:12」。秒数就是秒数,别四舍五入(倒计时差一秒用户看得见)。
 *  · `fmtSpan` —— **分钟级**(单堂时长、完成页统计、分享卡):「45 分钟」/「1 小时 2 分」。
 *    这一档本来就是估算,写「43 秒」是假精确。
 *
 * 休息的取值范围:`0` = 不休息(超级组、拉伸这类不需要计时的动作),到 `REST_MAX` 10 分钟。
 * 上限不再是 5 分钟 —— 大重量深蹲/硬拉组间歇 4~6 分钟是正常的,旧上限会把它们截断。
 */
/** 休息上限:10 分钟。再多就不是组间休息了 */
export const REST_MAX = 600;
/** 微调步长:5 秒(真实用法里没人调 1 秒、3 秒的休息) */
export const REST_STEP = 5;
/** 一按就到的常见值 —— 一次点击胜过十几下微调(留 8 个,手机上正好两行) */
export const REST_PRESETS: number[] = [0, 30, 45, 60, 90, 120, 180, 300];

/**
 * 休息秒数收进合法区间并取整。读不懂的输入(空、非数字)当 **0(不休息)** ——
 * 休息时间宁短勿长:记错了顶多是不计时,记长了会把用户按在椅子上。
 */
export function clampRest(sec: number, max = REST_MAX): number {
  const n = Math.round(Number(sec));
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(0, n));
}

/**
 * 秒级:`45s` / `1:30` / `1:05:12`;超过一小时才带小时段(休息到不了,训练计时会)。
 * `off` 传了就是 0 的念法(休息的 0 是「不休息」,计时器的 0 是 `0s`)。
 */
export function fmtDuration(sec: number, off?: string): string {
  const n = Math.max(0, Math.round(Number(sec)) || 0);
  if (!n && off != null) return off;
  if (n < 60) return `${n}s`;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * `fmtDuration` 的逆 —— 把写出来的时长读回秒数。
 *
 * 认:`45s` / `1:30` / `1:05:12` / `90秒` / `2分` / `2 分 30 秒` / `1小时5分` / `1h30m`;
 * 一个光秃秃的数字按**秒**读(`休 90` 是休息一分半,不是一分半钟的九十分钟)。
 * **读不懂返回 null,不猜 0** —— 猜成 0 等于「不休息」,把用户按在杠铃下少歇了;
 * 调用方接到 null 应当保留自己的默认值(见计划文字的导入)。
 */
export function parseDuration(text: string | number | null | undefined): number | null {
  const s = String(text ?? '').trim();
  if (!s) return null;
  // 时钟记法 `1:30` / `1:05:12`(冒号分开的段从左到右是 时:分:秒)
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(s);
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  let total = 0;
  let matched = false;
  const unit = /(\d+(?:\.\d+)?)\s*(小时|时|h|分|分钟|min|秒|s)/gi;
  let m: RegExpExecArray | null;
  while ((m = unit.exec(s))) {
    matched = true;
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    total += u === '小时' || u === '时' || u === 'h' ? n * 3600 : u === '秒' || u === 's' ? n : n * 60;
  }
  if (matched) return Math.round(total);
  return /^\d+$/.test(s) ? Number(s) : null;
}

/**
 * 分钟级:`9 分钟` / `1 小时 2 分` / `2 小时`;读不懂或 ≤0 记 `—`。
 * 不到一分钟的按 1 分钟算 —— 这一档本来就是估算,「43 秒」是假精确。
 */
export function fmtSpan(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const min = Math.round(sec / 60);
  if (min < 60) return `${Math.max(1, min)} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

/**
 * 单堂时长的**取值范围与步长** —— 手改时长的唯一收口(完成汇总页那一格、补录页那一格)。
 *
 * 为什么非要有手改出口:训练计时是**墙钟**算的(`Date.now() - startedAt`,见训练页的 finish),
 * 中途接个电话、器械被人占着、跟人聊了十分钟,这一节 45 分钟就会记成 65 分钟;补录的那次
 * 更干脆没有墙钟,只有一个按计划估的数。而时长进了「本周练了多久」「日均时长」这些统计,
 * 不修就一直错着。openGym 里这一格也是可改的(`SessionEdit` 的时长字段)。
 *
 * 为什么收口要放在这里:出口一旦散在各个页面,就会出现「完成页按 5 分钟调、补录页按 1 分钟调、
 * 某处还能填 300 小时」这种各说各话 —— 和 `clampRest` 是同一个理由。
 *
 * 单位**存的是秒**(和 `durationSec` 字段、墙钟计时同一种),读写按**分钟**来:这一档本来就是
 * 分钟级读数(见 `fmtSpan`),让人按秒调一整节课是在给假精度。
 */
/** 上限 6 小时。再多就不是练了一节课,是记错了 —— 别让一个手滑的数字进统计曲线 */
export const SPAN_MAX_MIN = 6 * 60;
/** 下限 1 分钟 —— 和墙钟计时的 `Math.max(60, …)`、`estSec` 的下限同一口径(一次训练不会是「0 分钟」) */
export const SPAN_MIN_MIN = 1;
/** 手改步长:5 分钟(没人按 1 分钟去调一整节课) */
export const SPAN_STEP_MIN = 5;

/**
 * 秒 → 可编辑的分钟数(取整并收进上下限)。
 * 读不懂的输入(空、NaN、负数)落到**下限**而不是 0 —— 0 在这一档没有意义,
 * 真在页面上出现个「0 分钟」用户还得再想一下那是什么意思。
 */
export function spanMinutes(sec: number): number {
  const n = Math.round((Number(sec) || 0) / 60);
  return Math.min(SPAN_MAX_MIN, Math.max(SPAN_MIN_MIN, n));
}

/**
 * 可编辑的分钟数 → 落盘的秒数(走同一个上下限,来回一趟不会漂)。
 * 手改过的时长存进去就是**整分钟**,不会留下 `4320` 这种「1 小时 12 分」的假精确。
 */
export const spanSeconds = (min: number): number => spanMinutes(min * 60) * 60;
