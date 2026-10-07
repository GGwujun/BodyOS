import { request } from './request';
import type { IngredientScanResult } from './types';

/** 配料表照片解析(配料顺序 + 提示) */
export function scanIngredients(image: string) {
  return request<IngredientScanResult>({ url: '/ai/ingredients/scan', method: 'POST', data: { image } });
}
