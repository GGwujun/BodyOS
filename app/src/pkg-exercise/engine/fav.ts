/**
 * 收藏动作 —— 让「我常做的那几个」在 1324 条里排到前面。
 *
 * 动作库的难点不是「找不到」,是「每次都要再找一遍」:一个练了半年的人,日常其实就在
 * 十几个动作里转,但动作库按部位分组、按名称排列,那十几个散在各处。收藏和「常用」
 * 是两种不同的信息,这里都收:
 *   - **收藏**是用户的**显式**选择(「这个我认」),存下来;
 *   - **常用**是**算出来的**(`usageOf` 从训练日志里数),不存 —— 数一次就有,存下来
 *     反而会出现「日志删了常用还在」的矛盾(和 distance/pace 一个道理:同一件事只留一处)。
 *
 * 排序口径(favsFirst):收藏的排最前 → 收藏内部按练过的次数 → 都排不出高下就保持
 * 原顺序。不按「加收藏的时间」排是因为那个顺序对用户没有意义,他关心的是「哪个我做得多」。
 */
import Taro from '@tarojs/taro';
import { markTouched } from '../../utils/sync-marks';
import type { WorkoutLog } from './types';

export const K_FAVS = 'bodyos.training.favs';

/** 收藏上限。收藏夹一旦超过一百条就不再是「我常做的」,而是第二份动作库 */
export const FAV_CAP = 100;

/** exerciseId → 练过几次(按**训练次数**算,不是组数:5 组卧推和 1 组卧推都是「练了一次」) */
export type UsageMap = Record<string, number>;

/** 清洗:去重、只留字符串、截断到上限。顺序有意义(见 sortedByFav),所以不敢排序 */
export function sanitizeFavs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= FAV_CAP) break;
  }
  return out;
}

export function loadFavs(): string[] {
  return sanitizeFavs(Taro.getStorageSync(K_FAVS));
}

export function saveFavs(ids: string[]): void {
  Taro.setStorageSync(K_FAVS, sanitizeFavs(ids));
  markTouched('favs', 'main');
}

export function isFav(favs: string[], id: string): boolean {
  return favs.includes(id);
}

/**
 * 加/取消收藏,返回新数组(不改原数组 —— 调用方直接 setState 就行)。
 * 新收藏的放**最后**:动作库里看「我的收藏」那一组时,先出现的是你最早认下的
 * 那几个(稳定的位置),新星的排在末尾 —— 星完立刻回到列表时不会整组跳位。
 */
export function toggleFav(favs: string[], id: string): string[] {
  if (!id) return favs;
  const clean = sanitizeFavs(favs);
  return clean.includes(id) ? clean.filter((x) => x !== id) : [...clean, id].slice(-FAV_CAP);
}

/** 从日志里数每个动作练过几次。补录的也算 —— 「我做过这个动作」跟数据来源无关 */
export function usageOf(logs: WorkoutLog[]): UsageMap {
  const out: UsageMap = {};
  for (const log of logs ?? []) {
    // 同一次训练里同一个动作出现两回只算一次
    const seen = new Set<string>();
    for (const e of log?.entries ?? []) {
      const id = e?.exerciseId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out[id] = (out[id] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * 收藏优先 + 常用优先的稳定排序。
 * 返回新数组;分不出高下的保持原顺序(Array.prototype.sort 在现代引擎里是稳定的,
 * 所以「什么条件都不满足就返回 0」正是我们要的 —— 不要在这里再加一个兜底比较)。
 */
export function sortedByFav<T extends { id: string }>(list: T[], favs: string[], usage: UsageMap = {}): T[] {
  const favIdx = new Map<string, number>();
  sanitizeFavs(favs).forEach((id, i) => favIdx.set(id, i));
  return [...list].sort((a, b) => {
    const fa = favIdx.get(a.id);
    const fb = favIdx.get(b.id);
    if ((fa === undefined) !== (fb === undefined)) return fa === undefined ? 1 : -1;
    const ua = usage[a.id] ?? 0;
    const ub = usage[b.id] ?? 0;
    if (ua !== ub) return ub - ua;
    if (fa !== undefined && fb !== undefined && fa !== fb) return fa - fb;
    return 0;
  });
}

/** 「练过 12 次」;没练过就是空串(列表上不显示一行「练过 0 次」) */
export function usageText(n: number | undefined): string {
  return n && n > 0 ? `练过 ${n} 次` : '';
}
