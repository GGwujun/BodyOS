import { chatJSON, type ZhipuMessage } from './zhipu';
import { matchFood } from '../data/foodDB';
import { z } from 'zod';

/**
 * 三阶段食物识别与热量计算
 * 阶段1【识别】:LLM 只负责"认出食物 + 估克数",不输出热量
 * 阶段2【查表】:用食物库查每100g营养值(精确锚定)
 * 阶段3【计算】:克数 × 查表值 = 精确热量/宏量
 *
 * 未命中食物库的条目:回退用 LLM 估算,并标记 low confidence。
 */

const SYSTEM = `你是 Body OS 的食物识别助手。任务:从用户描述/图片中识别出包含哪些食物,并估算每项的可食部克数。
规则:
- 只输出食物名和克数,不要估算热量或营养(热量由系统数据库计算)。
- 食物名用通用名(如"鸡胸肉"而非"健身餐里的白肉")。
- 克数尽量基于描述(如"2个鸡蛋"≈100g,"一碗米饭"≈200g),无法判断时给常见份量。
- 只输出 JSON,不要任何额外文字或代码块。`;

interface RecognizedItem {
  /** LLM 识别出的食物名(通用名) */
  name: string;
  /** 估算克数 */
  grams: number;
  /** 原始描述(用户写的份量,如"2 个") */
  rawAmount?: string;
}

/** 阶段1:LLM 识别食物 + 估克数 */
async function recognize(text?: string, imageBase64?: string): Promise<RecognizedItem[]> {

  const userContent = imageBase64
    ? [
        { type: 'text', text: '识别图片中所有食物并估算克数。' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64.replace(/^data:image\/\w+;base64,/, '') } }
      ]
    : `识别以下描述中的食物并估算每项克数。\n描述:"${text}"\n\n只返回 JSON:\n{"items":[{"name":"","grams":0,"rawAmount":""}]}`;

  const messages: ZhipuMessage[] = [{ role: 'user', content: userContent as unknown as string }];
  const result = await chatJSON<{ items: RecognizedItem[] }>(messages, {
    system: SYSTEM,
    temperature: 0.1,
    maxTokens: 800
  });
  const parsed = z.object({items:z.array(z.object({
    name:z.string().trim().min(1),
    grams:z.number().finite().positive(),
    rawAmount:z.string().optional()
  }))}).safeParse(result);
  if (!parsed.success) throw new Error('食物识别结果不完整，请重新识别或手动输入');
  return parsed.data.items;
}

export interface CalculatedFoodItem {
  name: string;
  amount: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  grams: number;
  /** 该项的置信度:查表命中=1, 包含匹配=0.85, LLM回退=0.5 */
  confidence: number;
  /** 营养数据来源:db(食物库) | llm(估算) */
  source: 'db' | 'llm';
}

export interface FoodRecognitionResult {
  items: CalculatedFoodItem[];
  /** 整体置信度(各条目加权平均,按克数) */
  confidence: number;
}

/** 阶段1-3 完整流程 */
export async function recognizeAndCalculate(
  text?: string,
  imageBase64?: string
): Promise<FoodRecognitionResult> {
  if (!text?.trim() && !imageBase64?.trim()) {
    throw new Error('请提供食物描述或图片');
  }
  const recognized = await recognize(text, imageBase64);

  const items: CalculatedFoodItem[] = [];
  let totalGrams = 0;
  let weightedConfSum = 0;

  for (const r of recognized) {
    const grams = r.grams;
    const match = matchFood(r.name);

    if (match) {
      // 阶段2-3:查表计算
      const ratio = grams / 100;
      const e = match.entry;
      items.push({
        name: e.name,
        amount: r.rawAmount || `${grams}g`,
        calories: Math.round(e.kcal * ratio),
        proteinG: round1(e.proteinG * ratio),
        carbG: round1(e.carbG * ratio),
        fatG: round1(e.fatG * ratio),
        fiberG: round1((e.fiberG ?? 0) * ratio),
        grams,
        confidence: match.confidence,
        source: 'db'
      });
      totalGrams += grams;
      weightedConfSum += match.confidence * grams;
    } else {
      // 未命中库:回退 LLM 估算(调用一个轻量补全)
      const est = await llmEstimateNutrition(r.name, grams);
      items.push({
        name: r.name,
        amount: r.rawAmount || `${grams}g`,
        calories: est.calories,
        proteinG: est.proteinG,
        carbG: est.carbG,
        fatG: est.fatG,
        fiberG: 0,
        grams,
        confidence: 0.5,
        source: 'llm'
      });
      totalGrams += grams;
      weightedConfSum += 0.5 * grams;
    }
  }

  const confidence = totalGrams > 0 ? round2(weightedConfSum / totalGrams) : 0;
  return { items, confidence };
}

/** 库未命中时,让 LLM 估算该食物每份的营养(明确标注为估算) */
async function llmEstimateNutrition(name: string, grams: number) {
  try {
    const r = await chatJSON<{ calories: number; proteinG: number; carbG: number; fatG: number }>(
      [{ role: 'user', content: `估算"${name}" ${grams}g 的热量与宏量(保守估算)。只返回JSON:{"calories":0,"proteinG":0,"carbG":0,"fatG":0}` }],
      { system: '保守估算,宁可偏低。只输出JSON。', temperature: 0.2, maxTokens: 200 }
    );
    return r;
  } catch {
    throw new Error('营养估算失败，请手动输入实际营养数据');
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
