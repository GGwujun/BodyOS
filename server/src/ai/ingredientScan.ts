import { chatJSON, type ZhipuMessage } from './zhipu';
import { UserError } from '../lib/userError';
import { z } from 'zod';

/**
 * 配料表照片解析:读出配料顺序 + 通用营养常识提示
 * 只输出结构化结果;提示为公开营养常识表述,不做健康断言
 */

export interface IngredientNote {
  level: 'info' | 'warn';
  text: string;
}

export interface IngredientScanResult {
  ingredients: string[];
  notes: IngredientNote[];
}

const SYSTEM = `你是 Body OS 的配料表解析助手。任务:从食品配料表照片中按顺序读出配料,并给出简短提示。
规则:
- 配料按照片中出现的顺序输出,最多 15 项,只写配料名。
- notes 按公开营养常识给提示,每条不超过 30 字,最多 4 条,不做医疗或健康断言:
  - 出现"氢化植物油/植脂末/代可可脂/人造奶油"→ level "warn",提示含反式脂肪风险
  - "白砂糖/果葡糖浆/葡萄糖浆"排在配料前三位 → level "warn",提示糖排前列
  - 常见添加剂(防腐剂/人工色素/甜味剂) → level "info",客观说明
  - 配料简短干净(≤5 项且无添加) → level "info",正面提示
- 照片不是配料表或无法辨认时,ingredients 返回空数组。
- 只输出 JSON,不要任何额外文字或代码块。`;

export async function scanIngredients(imageBase64: string): Promise<IngredientScanResult> {
  const dataUrlMime = /^data:(image\/\w+);base64,/.exec(imageBase64)?.[1] ?? 'image/jpeg';
  const content = [
    {
      type: 'text',
      text: '读出这张配料表照片中的配料与提示。只返回 JSON:{"ingredients":[""],"notes":[{"level":"warn","text":""}]}'
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: dataUrlMime,
        data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
      }
    }
  ];

  const messages: ZhipuMessage[] = [{ role: 'user', content: content as unknown as string }];
  const result = await chatJSON<unknown>(messages, { system: SYSTEM, temperature: 0.1, maxTokens: 600 });
  const parsed = z.object({
    ingredients: z.array(z.string().trim().min(1).max(40)).max(15),
    notes: z.array(z.object({
      level: z.enum(['info', 'warn']),
      text: z.string().trim().min(1).max(60)
    })).max(4)
  }).safeParse(result);
  if (!parsed.success) throw new UserError('配料解析结果不完整，请对准配料表重拍');
  if (parsed.data.ingredients.length === 0) {
    throw new UserError('没有认出配料表，请对准包装上的配料表拍摄');
  }
  return parsed.data;
}
