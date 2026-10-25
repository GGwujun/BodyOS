import Taro from '@tarojs/taro';
import { markTouched } from './sync-marks';
import {
  CUSTOM_PREFIX, EMPTY_PREFS, SITES, type CustomSiteDef, type GirthPrefs
} from './girth';

/**
 * 围度部位偏好的本机存储:哪些部位藏起来了、自己加过哪些部位。
 *
 * 偏好跟着账号同步(见 pkg-exercise/engine/sync.ts 的 'girth' 文档)——
 * 换台设备要是没把自建部位带过去,那边记录里 extras 那张表就成了没人认领的列。
 * 所以每次写入都记一笔修改时间(sync-marks),同步时用来判断谁新谁旧。
 */

const KEY = 'bodyos.girth.prefs';
/** 自建部位名字上限 —— 它要在录入表单和走势 chip 里当标签摆,太长把格子挤变形 */
export const CUSTOM_NAME_MAX = 12;
/** 自建部位个数上限:录入表单一屏放得下的量级,服务端 extras 也按这个量级校验 */
export const CUSTOM_CAP = 12;

const RE_ID = /^x-[a-z0-9]{4,10}$/;

/** 云端/本机存的东西一律先过这一遍:形状不对的丢掉,不让脏数据落进序列 */
export function sanitizeGirthPrefs(raw: unknown): GirthPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_PREFS };
  const src = raw as { hidden?: unknown; custom?: unknown };

  const builtinKeys = new Set(SITES.map((s) => s.k));
  const hidden: string[] = [];
  if (Array.isArray(src.hidden)) {
    for (const k of src.hidden) {
      // 只认得出这两种键:内置键、x- 开头的自建键;别的(老版本写的、手改的)直接扔
      if (typeof k !== 'string' || !(builtinKeys.has(k) || RE_ID.test(k))) continue;
      if (!hidden.includes(k)) hidden.push(k);
    }
  }

  const custom: CustomSiteDef[] = [];
  // 先把内置部位的名字占住:云端那份要是带着一个叫「腰围」的自建,只留内置那个 ——
  // 录入表单里两格一样的话,填了也不知道进了哪条
  const seen = new Set(SITES.map((s) => s.label.toLowerCase()));
  if (Array.isArray(src.custom)) {
    for (const c of src.custom) {
      if (!c || typeof c !== 'object') continue;
      const name = typeof (c as { name?: unknown }).name === 'string' ? (c as { name: string }).name.trim() : '';
      if (!name || name.length > CUSTOM_NAME_MAX) continue;
      // 重名只留第一个
      const low = name.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      custom.push({ id: (c as { id?: unknown }).id as string, name });
    }
  }

  // id 统一在这里补齐:过不了形状的就发一个新的(这种只可能来自云端脏数据 ——
  // 本机 addCustomSite 出来的 id 天生合规,而 id 不合规的自建也不可能有数据挂在它身上)
  const takenIds = new Set<string>();
  const out: GirthPrefs = {
    hidden,
    custom: custom.slice(0, CUSTOM_CAP).map((c) => {
      let id = typeof c.id === 'string' && RE_ID.test(CUSTOM_PREFIX + c.id) ? c.id : newSiteId(takenIds);
      while (takenIds.has(id)) id = newSiteId(takenIds);
      takenIds.add(id);
      return { id, name: c.name };
    })
  };
  return out;
}

const newSiteId = (taken: Set<string>): string => {
  let id = '';
  do {
    id = Math.random().toString(36).slice(2, 8);
  } while (taken.has(id));
  return id;
};

export function loadGirthPrefs(): GirthPrefs {
  return sanitizeGirthPrefs(Taro.getStorageSync(KEY));
}

/** 落盘前再洗一遍;顺手记修改时间,同步才知道这份比云端的旧还是新 */
export function saveGirthPrefs(p: GirthPrefs): GirthPrefs {
  const clean = sanitizeGirthPrefs(p);
  Taro.setStorageSync(KEY, clean);
  markTouched('girth', 'main');
  return clean;
}

/** 藏 / 显示一个部位(内置和自建都走这里)。返回落盘后的最新偏好 */
export function toggleSiteKey(k: string): GirthPrefs {
  const p = loadGirthPrefs();
  p.hidden = p.hidden.includes(k) ? p.hidden.filter((x) => x !== k) : [...p.hidden, k];
  return saveGirthPrefs(p);
}

/**
 * 加一个自建部位。重名(不分大小写)和内置部位撞名都拦 —— 序列、表单全按名字认人,
 * 两个「上臂围」只会让人搞不清哪个是哪个。
 */
export function addCustomSite(name: string): { ok: true; prefs: GirthPrefs } | { ok: false; why: string } {
  const n = name.trim();
  if (!n) return { ok: false, why: '先给这个部位起个名字' };
  if (n.length > CUSTOM_NAME_MAX) return { ok: false, why: `名字最多 ${CUSTOM_NAME_MAX} 个字` };
  const p = loadGirthPrefs();
  if (p.custom.length >= CUSTOM_CAP) return { ok: false, why: `自己加的部位最多 ${CUSTOM_CAP} 个` };
  const taken = new Set([...SITES.map((s) => s.label), ...p.custom.map((c) => c.name)].map((x) => x.toLowerCase()));
  if (taken.has(n.toLowerCase())) return { ok: false, why: '已经有叫这个名字的部位了' };
  const id = newSiteId(new Set(p.custom.map((c) => c.id)));
  const prefs = saveGirthPrefs({ ...p, custom: [...p.custom, { id, name: n }] });
  return { ok: true, prefs };
}

/**
 * 删一个自建部位(连带把它从 hidden 里摘掉)。量过的数仍留在记录的 extras 里 ——
 * 不跟着删,只是没有部位定义就再也显示不出来;同名再建一个也接不上(键是随机 id)。
 */
export function removeCustomSite(id: string): GirthPrefs {
  const p = loadGirthPrefs();
  return saveGirthPrefs({
    hidden: p.hidden.filter((x) => x !== CUSTOM_PREFIX + id),
    custom: p.custom.filter((c) => c.id !== id)
  });
}
