/**
 * 我的器材 — 杠铃杆重、杠铃片库存、哑铃档位、器械清单。
 *
 * 产品动机:训练计划说「今天卧推 60kg」,可用户站在杠铃前要先心算每边挂多少片;
 * 说「哑铃推举 12kg」,可他手里只有 10 和 14。记下来的重量永远保持「杠上的总重」
 * (历史、容量、1RM、渐进全按这个口径,不因为这里而改变) —— 本模块只做两件事:
 *  1. 把总重翻译成人能照做的话(每边挂什么片 / 还差几公斤);
 *  2. 让加重、减载、步进落在「他真正有的重量」上,而不是数学上的等距格点。
 *
 * 单位只做公斤。BodyOS 不做磅公斤双单位(见路线图「明确不移植」),所以这里没有
 * openGym 那套 per-unit 存储,省掉一整类「切单位把 45 磅的片变成 20.4 公斤」的坑。
 */
import Taro from '@tarojs/taro';
import { markTouched } from '../../utils/sync-marks';   // 相对路径:冒烟测试用纯 tsc 编译,不认 '@/' 别名
import { EXERCISES, EQUIPMENT_ZH, type ExerciseEntry } from '../data/exercises';

export const KIT_KEY = 'bodyos.training.kit';

/** 一档杠铃片的重量与对数(一对 = 一根杆一侧各一片…不,一对 = 两片 = 两侧各一片) */
export interface PlatePair { w: number; n: number }

export interface Kit {
  /** 我有的片:重量 → 对数。空/缺省 = 按标准馆配算,不假装用户有库存 */
  plates?: Record<string, number> | null;
  /** 每种杠铃杆的实际重量;0 = 这根杆不自重(反重力的史密斯机)。缺省用默认值 */
  bars?: Record<string, number>;
  /** 我有的哑铃/壶铃档位(单个的重量,kg),升序 */
  dumbbells?: number[];
  /** 我有的器械(equipment 值 + 卧推凳/单杠);null/缺省 = 没登记,不做筛选 */
  equipment?: string[] | null;
}

/** 器材编辑器列的档位,重的在前(和片架上找片的顺序一致) */
export const PLATE_SIZES = [25, 20, 15, 10, 5, 2.5, 1.25];
/** 标准馆配:每种 6 对够任何合理重量堆;1.25 的小片通常没那么多,给 2 对 */
const DEFAULT_PAIRS: Record<number, number> = { 25: 6, 20: 6, 15: 6, 10: 6, 5: 6, 2.5: 6, 1.25: 2 };

/** 用得上杠铃杆的器械 → 常见杆重(kg) */
export const BAR_DEFAULT_KG: Record<string, number> = {
  barbell: 20, 'olympic barbell': 20, 'ez barbell': 10, 'smith machine': 9, 'trap bar': 25
};
/** 卧推凳与单杠:动作库不给它们单独打 equipment 标签,只能从动作名读(见 accessoriesOf) */
export const ACCESSORIES = ['bench', 'pull-up bar'] as const;
export type Accessory = typeof ACCESSORIES[number];

const ACC_ZH: Record<string, string> = { bench: '卧推凳', 'pull-up bar': '单杠' };

/** 自带座椅/靠背/杆的器械 — 「器械上斜卧推」不需要另配卧推凳 */
const SELF_CONTAINED = new Set(['leverage machine', 'sled machine', 'assisted']);
/** 器械值里只有健身房才有的那批,用来把清单折算成计划里的「器械条件」 */
const GYM_ONLY = new Set([
  'barbell', 'olympic barbell', 'ez barbell', 'trap bar', 'smith machine',
  'cable', 'leverage machine', 'weighted', 'rope', 'sled machine', 'assisted'
]);
const HOME_EXTRA = new Set(['kettlebell', 'band', 'resistance band', 'medicine ball']);

const LABELS: Record<string, string> = { ...EQUIPMENT_ZH, ...ACC_ZH };

/** 器械英文 key → 中文(卧推凳/单杠这两个不在动作库的器械表里) */
export const kitLabel = (k: string): string => LABELS[k] ?? k;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------- 存储 ----------

const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** 一档器材的逐项清洗 —— **唯一闸门**:本机读、云同步写回、备份导入三条路都过它 */
function sanitizeKit(raw: unknown): Kit {
  if (!isMap(raw)) return {};
  const kit: Kit = {};
  if (isMap(raw.plates)) {
    const plates: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.plates)) if (num(k) > 0 && num(v) > 0) plates[k] = Math.floor(num(v));
    if (Object.keys(plates).length) kit.plates = plates;
  }
  if (isMap(raw.bars)) {
    const bars: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.bars)) if (num(v) >= 0 && v !== '' && v != null) bars[k] = num(v);
    if (Object.keys(bars).length) kit.bars = bars;
  }
  if (Array.isArray(raw.dumbbells)) {
    const ws = cleanWeights(raw.dumbbells);
    if (ws.length) kit.dumbbells = ws;
  }
  if (Array.isArray(raw.equipment)) kit.equipment = raw.equipment.filter((x): x is string => typeof x === 'string');
  return kit;
}

/**
 * 有没有登记过任何东西 — 决定页面是引导态还是编辑态、备份算不算有内容。
 * `plates` / `bars` 是**表**不是数组,得数键 —— 写成 `.length` 的话「只登记了片」
 * 会被判成空(冒烟逮到过:那样一份备份会被整个判为「没有训练数据」)。
 */
export const kitEmpty = (kit: Kit): boolean =>
  !Object.keys(kit.plates ?? {}).length && !Object.keys(kit.bars ?? {}).length
  && !(kit.dumbbells?.length) && !(kit.equipment?.length);

/* ============================ 几套器材 ============================ */
/**
 * 为什么要「几套」:同一个人有健身房、家里、出差三处练的地方,而「我有哪些片/哪些器械」
 * 是三份不同的答案 —— 现在只有一份,换个地方练就得重登记一遍,回来还得再登记回来。
 *
 * **只有「现在在用的那一套」参与别处的口径**(配片/步进/器械筛选都走 `loadKit()`),所以
 * 上面那一堆纯函数一个都不用改 —— 「几套」是一层**存储**上的事,不是一层器材口径。
 *
 * 存储里那份是 v2:`{ v, list, current }`。老版本存的是一个裸的 `Kit`,读的时候**就地
 * 包成第一套**(名字「我常用的」)—— 用户不需要知道有过这个变迁,也没有一步迁移动作。
 * 同步与备份搬的就是这一整份(见 sync.ts / backup.ts),所以几套器材跟人走,不是本机设置。
 */
export interface KitProfile {
  id: string;
  name: string;
  kit: Kit;
}
export interface KitDoc {
  v: 2;
  list: KitProfile[];
  current: string;
}

/** 老数据包成的那一套的名字(也是唯一一套时的样子) */
export const LEGACY_PROFILE_NAME = '我常用的';
/** 最多存几套 —— 这是防存储与同步 payload 撑爆的界,不是产品规则(6 套够任何真实用法) */
export const PROFILE_MAX = 6;
/** 名字长度上限(和动作备注同一个量级:够写「老王家楼下的健身房」) */
export const PROFILE_NAME_MAX = 12;

const newProfileId = (used: Set<string>): string => {
  // 随机后缀而不是时间戳:连点两下「新建」会落在同一毫秒,撞 id 就是两套合成一套(M4.2 照片那次逮到的)
  let id = '';
  do { id = `k-${Math.random().toString(36).slice(2, 10)}`; } while (used.has(id));
  return id;
};

const cleanName = (name: string, fallback: string): string => {
  const t = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, PROFILE_NAME_MAX);
  return t || fallback;
};

/**
 * 补出来的 id 必须**每次都一样**:`readDoc()` 只读不写,所以老数据(裸 Kit)在第一次改动
 * 落盘之前,每次读都会重新归一 —— 随机 id 的话「刚拿到的 id」和「下一次读到的 current」
 * 永远对不上,`switchProfile` / 页面上的「哪套在用」会随机失灵(冒烟逮到过)。
 * 所以这里用位置推出来的名字,不用 `newProfileId`(那个只给「用户新建的那套」)。
 */
const derivedId = (want: unknown, idx: number): string =>
  typeof want === 'string' && want ? want : `p-${idx}`;

function normalizeDoc(raw: unknown): KitDoc {
  const list: KitProfile[] = [];
  const used = new Set<string>();
  /** 收下一个 id:空的按位置补,重的在后面加序号 —— 都以「位置」为准,所以读几次都一样 */
  const takeId = (want: unknown, idx: number): string => {
    const base = derivedId(want, idx);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  if (isMap(raw) && raw.v === 2 && Array.isArray(raw.list)) {
    for (const p of raw.list) {
      if (!isMap(p)) continue;
      list.push({
        id: takeId(p.id, list.length),
        name: cleanName(p.name as string, `器材 ${list.length + 1}`),
        kit: sanitizeKit(p.kit)
      });
      if (list.length >= PROFILE_MAX) break;
    }
  }
  if (!list.length) {
    // v1(裸的 Kit)或者被写坏 —— 整份当第一套,id 固定(它是「唯一那一套」,不需要随机)
    const id = takeId('k-main', 0);
    list.push({ id, name: LEGACY_PROFILE_NAME, kit: sanitizeKit(raw) });
    return { v: 2, list, current: id };
  }
  const cur = isMap(raw) && typeof raw.current === 'string' ? raw.current : '';
  return { v: 2, list, current: list.some((p) => p.id === cur) ? cur : list[0].id };
}

function readDoc(): KitDoc {
  return normalizeDoc(Taro.getStorageSync(KIT_KEY));
}

function writeDoc(doc: KitDoc): KitDoc {
  Taro.setStorageSync(KIT_KEY, doc);
  markTouched('kit', 'main');
  return doc;
}

/** 现在在用的那一套 —— 全应用只认这一个 */
export function loadKit(): Kit {
  const doc = readDoc();
  return doc.list.find((p) => p.id === doc.current)?.kit ?? doc.list[0].kit;
}

/** 改「现在在用的那一套」—— 所有既有调用方不用知道「几套」这回事 */
export function saveKit(kit: Kit): Kit {
  const doc = readDoc();
  writeDoc({ ...doc, list: doc.list.map((p) => (p.id === doc.current ? { ...p, kit: sanitizeKit(kit) } : p)) });
  return kit;
}

/* ---- 几套的增删改查(只有器材页用) ---- */

/** 整份(几套 + 哪套在用)—— 同步与备份搬它,不是搬 `loadKit()` */
export const loadKitDoc = (): KitDoc => readDoc();

/** 从别处(云同步 / 备份文件)拿回来的一份 —— 过同一道清洗再落盘 */
export const applyKitDoc = (raw: unknown): KitDoc => writeDoc(normalizeDoc(raw));

export const listProfiles = (): KitProfile[] => readDoc().list;
export const currentProfileId = (): string => readDoc().current;
export const profileName = (): string => {
  const doc = readDoc();
  return doc.list.find((p) => p.id === doc.current)?.name ?? LEGACY_PROFILE_NAME;
};

/** 切到某一套 —— 不存在就什么都不做(页面拿它当兜底,不该由它抛错) */
export function switchProfile(id: string): KitDoc {
  const doc = readDoc();
  if (!doc.list.some((p) => p.id === id)) return doc;
  return writeDoc({ ...doc, current: id });
}

/** 存成新的一套并切过去。**照现在这套复制** —— 常见的第二套是「差不多但少几样」,
 *  而空白那套要从头勾一遍(要空的,切过去之后「清空」几下就空了)。 */
export function addProfile(name: string): KitDoc {
  const doc = readDoc();
  if (doc.list.length >= PROFILE_MAX) return doc;
  const id = newProfileId(new Set(doc.list.map((p) => p.id)));
  const kit = doc.list.find((p) => p.id === doc.current)?.kit ?? {};
  return writeDoc({ ...doc, list: [...doc.list, { id, name: cleanName(name, '新的一套'), kit: { ...kit } }], current: id });
}

export function renameProfile(id: string, name: string): KitDoc {
  const doc = readDoc();
  return writeDoc({
    ...doc,
    list: doc.list.map((p) => (p.id === id ? { ...p, name: cleanName(name, p.name) } : p))
  });
}

/** 删掉一套。最后一套不许删(删了就没地方存器材了,而「没登记的器材」和「空的那一套」不是一回事) */
export function removeProfile(id: string): KitDoc {
  const doc = readDoc();
  if (doc.list.length <= 1) return doc;
  const list = doc.list.filter((p) => p.id !== id);
  return writeDoc({ ...doc, list, current: doc.current === id ? list[0].id : doc.current });
}

/**
 * 这几套里有没有登记过东西 —— 决定同步推不推、备份算不算有内容。
 * 参数收 `unknown` 而不是 `KitDoc`:备份/同步里那一格可能是**老版本存下来的裸 Kit**
 * (甚至彻底是别的东西),这里要的只是「有没有东西」,过一遍归一就够了。
 */
export const kitDocEmpty = (raw: unknown): boolean =>
  normalizeDoc(raw).list.every((p) => kitEmpty(p.kit));

// ---------- 杠铃:杆重 ----------

/** 这个动作要不要杠铃杆 */
export const usesBar = (ex: ExerciseEntry | null | undefined): boolean =>
  !!ex && ex.equipment in BAR_DEFAULT_KG;

/**
 * 这个动作实际起始重量:自己设过的杆重优先(0 是「这根杆不自重」,是真答案不是缺省),
 * 否则按器械类型的默认杆重。非杠铃动作返回 0。
 */
export function barWeightFor(kit: Kit, ex: ExerciseEntry | null | undefined): number {
  if (!ex) return 0;
  const own = kit.bars?.[ex.equipment];
  if (own != null) return Math.max(0, num(own));
  return BAR_DEFAULT_KG[ex.equipment] ?? 0;
}

// ---------- 杠铃:配片 ----------

/** 我有的片,重的在前。没登记库存 → 标准馆配 */
export function plateInv(kit: Kit): PlatePair[] {
  const own = Object.entries(kit.plates ?? {})
    .map(([k, v]) => ({ w: num(k), n: Math.floor(num(v)) }))
    .filter((p) => p.w > 0 && p.n > 0);
  if (own.length) return own.sort((a, b) => b.w - a.w);
  return PLATE_SIZES.map((w) => ({ w, n: DEFAULT_PAIRS[w] })).sort((a, b) => b.w - a.w);
}

/** 是否登记了自己的片(没登记就不该说「你的片不够」) */
export const ownsPlates = (kit: Kit): boolean => plateInv(kit).length > 0 && !!Object.keys(kit.plates ?? {}).length;

// 一切换算都走 1/4 公斤的整数格,1.25 和 2.5 才不会出现浮点残渣
const Q = 4;
const q = (w: number): number => Math.round(w * Q);

/**
 * 一侧要挂哪些片。
 * 先按「重的先上」贪心 —— 现实中人就是这么挂牌子的,出来的结果也最好认;
 * 贪心配不平时(家里每种只有一对、库存很偏)退到「片数最少的精确解」(背包 DP),
 * 还凑不出就取不超过目标的**最重可达重量**,并如实报差多少 —— 编一个假的精确解
 * 比说「还差 2.5kg」糟得多。
 *   → { plates: [重量…] 重的在前, missing: 差多少公斤 }
 */
export function plateStack(perSideKg: number, inv: PlatePair[]): { plates: number[]; missing: number } {
  const want = Math.max(0, perSideKg);
  const target = Math.floor(want * Q);
  if (target <= 0) return { plates: [], missing: want };
  const items = (inv ?? []).filter((p) => p.w > 0 && p.n > 0).sort((a, b) => b.w - a.w);
  // 1) 重的先上
  const greedy: number[] = [];
  let left = target;
  for (const p of items) {
    const u = q(p.w);
    let k = Math.min(p.n, Math.floor(left / u));
    while (k-- > 0) { greedy.push(p.w); left -= u; }
  }
  const stock = items.reduce((s, p) => s + q(p.w) * p.n, 0);
  // 目标 ≥ 全部库存:贪心已经把片子全挂上了,剩的就是真的没有。
  // 这个短路还顺手挡住「输入框里按 9999」—— 否则下面那张表会长到目标值那么大。
  if (left === 0 || target >= stock) return { plates: greedy, missing: want - (target - left) / Q };

  // 2) 片数最少的精确解:f[i][s] = 用 i 之后的档位凑出 s 要几片
  const n = items.length;
  const INF = 1e9;
  const f: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(target + 1).fill(INF));
  f[n][0] = 0;
  for (let i = n - 1; i >= 0; i--) {
    const u = q(items[i].w);
    const cap = items[i].n;
    for (let s = 0; s <= target; s++) {
      let best = f[i + 1][s];
      for (let k = 1; k <= cap && k * u <= s; k++) {
        const v = f[i + 1][s - k * u];
        if (v + k < best) best = v + k;
      }
      f[i][s] = best;
    }
  }
  // 不超过目标的、够得着的最大重量
  let sum = target;
  while (sum > 0 && f[0][sum] >= INF) sum--;
  const plates: number[] = [];
  let s = sum;
  for (let i = 0; i < n; i++) {
    const u = q(items[i].w);
    const cap = items[i].n;
    // 取「仍然留得下最优解」的最大片数 → 同样片数时重的优先
    for (let k = Math.min(cap, Math.floor(s / u)); k >= 0; k--) {
      if (f[i + 1][s - k * u] + k === f[i][s]) {
        for (let j = 0; j < k; j++) plates.push(items[i].w);
        s -= k * u;
        break;
      }
    }
  }
  return { plates, missing: want - sum / Q };
}

/** 配片结果 → 一行字:「25 + 10」/「20 × 2 + 5」 */
export function plateText(plates: number[]): string {
  const order: number[] = [];
  const count = new Map<number, number>();
  for (const w of plates ?? []) {
    if (!count.has(w)) order.push(w);
    count.set(w, (count.get(w) ?? 0) + 1);
  }
  return order.map((w) => (count.get(w)! > 1 ? `${w} × ${count.get(w)}` : `${w}`)).join(' + ');
}

export interface RowLoad {
  /** 一侧的片重 */
  perSide: number;
  plates: number[];
  /** 库存凑不出时差多少公斤 */
  missing: number;
}

/**
 * 一个重量怎么上杠:null = 这动作不用杆 / 没重量;
 * { perSide: 0 } = 重量还没超过空杆,不用挂片。
 */
export function rowLoad(kit: Kit, weightKg: number | null | undefined, ex: ExerciseEntry | null | undefined): RowLoad | null {
  if (!usesBar(ex)) return null;
  const w = num(weightKg);
  if (!(w > 0)) return null;
  const bar = barWeightFor(kit, ex);
  if (w <= bar) return { perSide: 0, plates: [], missing: 0 };
  const perSide = Math.round(((w - bar) / 2) * 100) / 100;
  const { plates, missing } = plateStack(perSide, plateInv(kit));
  return { perSide, plates, missing: Math.round(missing * 100) / 100 };
}

/** 配片结果 → 用户看得懂的一句(供训练页/计划页的行尾) */
export function loadHint(kit: Kit, weightKg: number | null | undefined, ex: ExerciseEntry | null | undefined): string | null {
  const load = rowLoad(kit, weightKg, ex);
  if (!load) return null;
  const bar = barWeightFor(kit, ex);
  if (load.perSide <= 0) return `空杆 ${w0(bar)}kg,不用挂片`;
  const head = `每边 ${plateText(load.plates)}`;
  if (load.missing > 0.001) {
    return ownsPlates(kit)
      ? `${head},还差 ${w0(load.missing)}kg(片不够)`
      : `${head},还差 ${w0(load.missing)}kg`;
  }
  return head;
}

const w0 = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * 不超过 target(1/4 公斤格)的最大可达和 —— 只问「够不够得着」,不做回溯。
 * 比 plateStack 那套带记录的 DP 轻得多,够 snappedByPlates 用了。
 */
function reachableMax(target: number, items: PlatePair[]): number {
  const cap = new Uint8Array(target + 1);
  cap[0] = 1;
  for (const p of items) {
    const u = q(p.w);
    if (u <= 0 || u > target) continue;
    for (let copy = 0; copy < p.n; copy++) {
      for (let s = target; s >= u; s--) if (cap[s - u]) cap[s] = 1;
    }
  }
  let s = target;
  while (s > 0 && !cap[s]) s--;
  return s;
}

/**
 * 把这堆片配不出来的重量,拉回到能配出来的最近一档(只往下,不往上)。
 * 用途:步进器按一下之后落地 —— 「加 2.5kg」在数学上没问题,可家里只有一副 5 和一副 10,
 * 那个重量他根本挂不出来。没登记片库存 / 不是杠铃动作 → 原样返回,一切照旧。
 */
export function snappedByPlates(kit: Kit, weightKg: number, ex: ExerciseEntry | null | undefined): number {
  if (!ownsPlates(kit) || !usesBar(ex)) return weightKg;
  const bar = barWeightFor(kit, ex);
  if (!(weightKg > bar)) return weightKg;
  const perSide = Math.round(((weightKg - bar) / 2) * 100) / 100;
  const target = Math.floor(perSide * Q);
  const items = plateInv(kit);
  // 目标比全部库存还重 → 最多就是全挂上;这个短路同时挡住「输入框里按 9999」把 DP 表撑爆
  const stock = items.reduce((s, p) => s + q(p.w) * p.n, 0);
  const sum = target >= stock ? stock : reachableMax(target, items);
  // 一片都挂不上(无杆 + 库存凑不出这一格)→ 别把重量拉到 0,原地不动更好;屏幕上那句
  // 「还差多少」已经把实情说了
  if (sum === target || sum <= 0) return weightKg;
  return Math.round((bar + (sum / Q) * 2) * 100) / 100;
}

// ---------- 哑铃/壶铃档位 ----------

/** 哑铃编辑器给的快选档位:2-50kg 每 2 公斤一档(和市面上可调哑铃的常见档位一致) */
export const DUMBBELL_PRESETS: number[] = Array.from({ length: 25 }, (_, i) => 2 + i * 2);

/** 去重、排序、剔掉不合理的值 —— 脏数据不许流进步进器 */
export function cleanWeights(list: unknown): number[] {
  const arr = Array.isArray(list) ? list : [];
  const out = new Set<number>();
  for (const v of arr) {
    const w = Math.round(num(v) * 100) / 100;
    if (w > 0 && w < 1000) out.add(w);
  }
  return [...out].sort((a, b) => a - b);
}

const EPS = 1e-6;

/** 我有的、比 w 重的最近一档;到顶返回 null(说明该加重但没有更重的铃了) */
export const ownedUp = (ws: number[], w: number): number | null =>
  (ws ?? []).find((x) => x > num(w) + EPS) ?? null;

/** 我有的、比 w 轻的最近一档;到底返回 null */
export function ownedDown(ws: number[], w: number): number | null {
  const below = (ws ?? []).filter((x) => x < num(w) - EPS);
  return below.length ? below[below.length - 1] : null;
}

/** 不超过 x 的最重一档;比最轻的还轻则给最轻的(总得练) */
export function ownedFloor(ws: number[], x: number): number {
  const list = ws ?? [];
  if (!list.length) return 0;
  const under = list.filter((v) => v <= num(x) + EPS);
  return under.length ? under[under.length - 1] : list[0];
}

/**
 * 减载落在哪一档:比 w 轻的那些里,离 w×factor 最近的一档(一样近取重的那个)。
 * 没有更轻的 → 保持 w(降无可降就别降了)。
 */
export function ownedDeload(ws: number[], w: number, factor: number): number {
  const below = (ws ?? []).filter((x) => x < num(w) - EPS);
  if (!below.length) return w;
  const ideal = num(w) * factor;
  return below.reduce((best, x) =>
    (Math.abs(x - ideal) < Math.abs(best - ideal) - EPS
      || (Math.abs(x - ideal) <= Math.abs(best - ideal) + EPS && x > best) ? x : best), below[0]);
}

/**
 * 步进器按一下:落在相邻的那一档上;到顶/到底则原地不动(比跳回另一头强得多 ——
 * 用户按「＋」是想加重,不是想从 40 掉回 2)。
 */
export function stepOwned(ws: number[], v: number, dir: number): number {
  const list = cleanWeights(ws);
  if (!list.length) return num(v);
  return (dir > 0 ? ownedUp(list, v) : ownedDown(list, v)) ?? num(v);
}

// ---------- 器械清单 ----------

/** 一个动作额外要什么配件(读英文名 —— 库里的名字是标准英文动作名,比中文名规整) */
export function accessoriesOf(ex: ExerciseEntry | null | undefined): string[] {
  if (!ex?.name || SELF_CONTAINED.has(ex.equipment)) return [];
  const n = ex.name.toLowerCase();
  const need: string[] = [];
  if (/\bbench\b|\bincline\b|\bdecline\b/.test(n)) need.push('bench');
  if (/pull-up|pull up|chin-up|\bchin\b|hanging|muscle-up|muscle up/.test(n)) need.push('pull-up bar');
  return need;
}

/** 清单里该列的器械:动作用到过的,按动作数从多到少,再把卧推凳/单杠接在后面 */
export const KIT_EQUIPMENT: string[] = (() => {
  const count: Record<string, number> = {};
  for (const e of EXERCISES) if (e.equipment) count[e.equipment] = (count[e.equipment] ?? 0) + 1;
  const ranked = Object.keys(count).sort((a, b) => count[b] - count[a] || (a < b ? -1 : 1));
  return ranked.concat([...ACCESSORIES]);
})();

const inLibrary = (eq: string): boolean => eq in EQUIPMENT_ZH;

/**
 * 这个动作在「我有的器械」下能不能做。
 * 没登记清单 → 一律可用(纯增量,绝不因为没设置就把动作库清空);
 * 动作库之外的自定义器械值 → 不拦(拦了用户就再也找不回自己的动作了);
 * 自重永远可用 —— 没有哪种装备条件能把引体向上从你身上拿走。
 */
export function availableWith(kit: Kit, ex: ExerciseEntry): boolean {
  // 空清单 = 没登记 = 不筛。绝不能让「清空勾选」变成「所有动作都做不了」
  const have = kit.equipment;
  if (!have?.length) return true;
  if (ex.equipment !== 'body weight' && inLibrary(ex.equipment) && !have.includes(ex.equipment)) return false;
  return accessoriesOf(ex).every((a) => have.includes(a));
}

/** 清单折算成计划生成用的「器械条件」—— 让生成器不用知道清单这回事 */
export function accessFor(kit: Kit): 'body' | 'dumbbell' | 'home' | 'gym' {
  const have = kit.equipment;
  if (!have?.length) return 'body';
  if (have.some((e) => GYM_ONLY.has(e))) return 'gym';
  if (have.some((e) => HOME_EXTRA.has(e))) return 'home';
  if (have.includes('dumbbell')) return 'dumbbell';
  return 'body';
}

/**
 * 计划里有哪些动作按「我的器材」做不了,把它们缺的器械名列出来(去重)。
 * 空清单 → 没有答案:没登记等于不筛,不是「家里什么都没有」;
 * 自建动作(库里查不到)和动作库之外的器械值 → 不拦,拦了用户就找不回自己的动作。
 */
export function missingKitOf(kit: Kit, exercises: (ExerciseEntry | null | undefined)[]): string[] {
  const have = kit.equipment;
  if (!have?.length) return [];
  const out = new Set<string>();
  for (const ex of exercises) {
    if (!ex || availableWith(kit, ex)) continue;
    if (ex.equipment !== 'body weight' && inLibrary(ex.equipment) && !have.includes(ex.equipment)) {
      out.add(kitLabel(ex.equipment));
    }
    for (const a of accessoriesOf(ex)) if (!have.includes(a)) out.add(kitLabel(a));
  }
  return [...out];
}

/** 我的器材一句话摘要(设置卡/计划页用) */
export function kitSummary(kit: Kit): string {
  const bits: string[] = [];
  if (kit.equipment?.length) bits.push(`${kit.equipment.length} 种器械`);
  if (kit.dumbbells?.length) bits.push(`哑铃 ${kit.dumbbells[0]}-${kit.dumbbells[kit.dumbbells.length - 1]}kg`);
  if (ownsPlates(kit)) bits.push(`${Object.values(kit.plates ?? {}).reduce((a, b) => a + b, 0)} 对杠铃片`);
  if (kit.bars && Object.keys(kit.bars).length) bits.push('杆重已设');
  return bits.join(' · ');
}
