import { chatJSON, chat, type ZhipuMessage } from './zhipu';

/* ============ 类型(与前端 services/types 对齐) ============ */
export interface FoodItem {
  name: string;
  amount: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG?: number;
}

export interface FoodParseResult {
  items: FoodItem[];
  confidence: number;
}

export interface ActivityParseResult {
  activities: {
    type: string;
    durationMin?: number;
    calories: number;
    startedAt?: string;
    /** 距离(米)。模型按「公里」回答(见 parseActivity 的提示词),这里是换算后的结果 */
    distanceM?: number;
    /** 跑步机坡度(%) */
    inclinePct?: number;
  }[];
  confidence: number;
}

export interface DailyAnalysis {
  summary: string;
  highlights: string[];
  issues: string[];
  actions: { title: string; reason: string }[];
}

export interface WeeklyAnalysis {
  score: number;
  grade: string;
  changes: { label: string; value: string }[];
  wins: string[];
  issues: string[];
  actions: string[];
}

const SYSTEM = `你是 Body OS 的营养与运动分析引擎。所有结论遵循"结论 → 依据 → 行动"。
- 数值用千克/克/千卡/分钟等标准单位。
- 估算值必须保守,并附带 confidence(0-1)。
- 不夸大、不编造数据。无法判断时宁可留空。
- 当被要求返回 JSON 时,只输出 JSON,不要任何额外说明或代码块标记。`;

/* ============ 食物解析 ============ */
export async function parseFood(text: string): Promise<FoodParseResult> {
  const messages: ZhipuMessage[] = [
    {
      role: 'user',
      content: `解析以下饮食描述为食物条目,估算每项热量与宏量营养素。
描述:"${text}"

只返回 JSON,格式:
{"items":[{"name":"","amount":"","calories":0,"proteinG":0,"carbG":0,"fatG":0,"fiberG":0}],"confidence":0.8}`
    }
  ];
  return chatJSON<FoodParseResult>(messages, { system: SYSTEM, temperature: 0.2, maxTokens: 800 });
}

/* ============ 运动解析 ============ */
/**
 * 模型按「公里」回答 distanceKm,这一层换算成米并做合理性兜底。
 * 为什么不直接让它给米:模型对 5 和 5000 哪个是公里数并不可靠,而「公里」正是用户原话里的单位;
 * 换算是确定性的,放在这里只需要判一次。
 */
function toMeters(km: unknown): number | undefined {
  const n = typeof km === 'number' ? km : typeof km === 'string' ? Number(km) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 500) return undefined;
  return Math.round(n * 1000);
}

/** 模型给的时间戳:能解析成日期才留,空串/乱码一律当没给(客户端会补当前时间) */
function toISO(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString();
}

/** 坡度:和客户端同一口径(0-40,半格一档);模型乱给就丢掉 */
function toIncline(pct: unknown): number | undefined {
  const n = typeof pct === 'number' ? pct : typeof pct === 'string' ? Number(pct) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 40) return undefined;
  return Math.round(n * 2) / 2;
}

export async function parseActivity(text: string): Promise<ActivityParseResult> {
  const messages: ZhipuMessage[] = [
    {
      role: 'user',
      content: `解析以下运动描述为活动条目,估算消耗(按 70kg 成人)。
描述:"${text}"

只填描述里确实说到的字段:没提到距离就不要填 distanceKm,没提到坡度就不要填 inclinePct。
距离一律按公里填(跑了 5.2 公里 → distanceKm:5.2)。
只返回 JSON,格式:
{"activities":[{"type":"","durationMin":0,"calories":0,"startedAt":"","distanceKm":0,"inclinePct":0}],"confidence":0.8}`
    }
  ];
  const raw = await chatJSON<
    ActivityParseResult & { activities?: (ActivityParseResult['activities'][number] & { distanceKm?: unknown })[] }
  >(messages, { system: SYSTEM, temperature: 0.2, maxTokens: 600 });

  return normalizeActivities(raw);
}

/** 模型可能返回的样子:字段全按未知处理,别把它的输出当自己人 */
export interface RawActivityParse {
  activities?: unknown;
  confidence?: unknown;
}

/**
 * 把模型的返回整成能进库的东西。**这里假设输入全是垃圾** ——
 * 模型会返回字符串数字、空串、多余字段、甚至直接忘了 activities。
 * 每一条出去了都要能通过 activity 路由的 zod 校验,否则就是「点确认保存 → 参数错误」这种
 * 用户看不懂的失败。换算规则和客户端 utils/cardio.ts 保持一致。
 */
export function normalizeActivities(raw: RawActivityParse | null | undefined): ActivityParseResult {
  const list = Array.isArray(raw?.activities) ? (raw!.activities as Record<string, unknown>[]) : [];
  const activities = list
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({
      type: String(a.type ?? '').slice(0, 30),
      durationMin: positiveInt(a.durationMin, 24 * 60),
      calories: positiveInt(a.calories, 20_000) ?? 0,
      // 空串也要当没给:客户端写的是 `a.startedAt ?? nowISO()`,而 '' 不是 nullish,
      // 空时间戳会一路走到服务的 datetime 校验上,整条记录都建不进去
      startedAt: toISO(a.startedAt),
      distanceM: toMeters(a.distanceKm),
      inclinePct: toIncline(a.inclinePct)
    }));
  return { activities, confidence: clamp01(Number(raw?.confidence)) };
}

function positiveInt(v: unknown, max: number): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > max) return undefined;
  return Math.round(n);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/* ============ 每日分析 ============ */
export async function dailyAnalysis(summary: unknown): Promise<DailyAnalysis> {
  const messages: ZhipuMessage[] = [
    {
      role: 'user',
      content: `基于今日数据,给出每日分析。数据如下(JSON):
${JSON.stringify(summary)}

只返回 JSON,格式:
{"summary":"","highlights":[""],"issues":[""],"actions":[{"title":"","reason":""}]}`
    }
  ];
  return chatJSON<DailyAnalysis>(messages, { system: SYSTEM, temperature: 0.4, maxTokens: 800 });
}

/* ============ 周报 ============ */
export async function weeklyAnalysis(weekData: unknown): Promise<WeeklyAnalysis> {
  const messages: ZhipuMessage[] = [
    {
      role: 'user',
      content: `基于本周数据生成周报。数据如下(JSON):
${JSON.stringify(weekData)}

评分满分 100,等级 A+/A/B+/B/C。
只返回 JSON,格式:
{"score":0,"grade":"","changes":[{"label":"","value":""}],"wins":[""],"issues":[""],"actions":[""]}`
    }
  ];
  return chatJSON<WeeklyAnalysis>(messages, { system: SYSTEM, temperature: 0.4, maxTokens: 1000 });
}

/* ============ AI 教练对话 ============ */
export async function coachChat(
  history: { role: 'user' | 'assistant'; content: string }[],
  context: unknown
): Promise<string> {
  const messages: ZhipuMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
  return chat(messages, {
    system: `${SYSTEM}\n用户健康数据上下文(JSON):\n${JSON.stringify(context)}`,
    temperature: 0.5,
    maxTokens: 512
  });
}
