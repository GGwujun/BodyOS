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
export async function parseActivity(text: string): Promise<ActivityParseResult> {
  const messages: ZhipuMessage[] = [
    {
      role: 'user',
      content: `解析以下运动描述为活动条目,估算消耗(按 70kg 成人)。
描述:"${text}"

只返回 JSON,格式:
{"activities":[{"type":"","durationMin":0,"calories":0,"startedAt":""}],"confidence":0.8}`
    }
  ];
  return chatJSON<ActivityParseResult>(messages, { system: SYSTEM, temperature: 0.2, maxTokens: 600 });
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
