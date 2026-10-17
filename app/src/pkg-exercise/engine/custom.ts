/**
 * 自定义动作 —— 用户自己建的动作(健身房里那台动作库里没有的器械、教练布置的变式)。
 *
 * 动作库是**固定的 1,324 条**(exercisedb 的 MIT 条目 + free-exercise-db 的 Unlicense 文字,
 * 见 NOTICE),所以「库里没有的动作」原本只能写进备注里,而单侧折算、重量怎么说、
 * 肌群统计、恢复、1RM 这些**按 id 走的口径全都不认识它**。这一层要做的事只有一件:
 * 把一个自定义动作变成一个**动作库里的动作**(同样的形状、自己的 id),
 * 于是那些口径一处都不用改 —— 这正是「同一个事实只有一个翻译层」要的效果。
 *
 * 三个和 openGym 的 `customEx` 不一样的决定:
 *   ① **不另开描述字段**。动作库那条「动作步骤」是教学文字,而用户自己写的要点本来就有住处
 *      —— 动作常驻备注(`store.setNote`,也是按 exerciseId 存的)。再开一个描述字段等于
 *      同一件事有两个写法:用户不知道该写哪个,两处都要显示,还得定谁盖在谁上面。
 *   ② **单侧/助力是勾出来的,不猜**。动作库靠英文名正则判单侧(engine/sided.ts)、靠
 *      「器械是固定器械 + 名字里有 assist」判助力(engine/load.ts),而用户起的名字根本不在
 *      那套正则的射程里(「我的推胸机」)。所以这两个标记在创建时直接问,口径层信它。
 *   ③ **删除是「退场」不是「抹掉」**。标记 `deletedAt`:从所有选择列表里消失,
 *      但 id 仍然认得出来 —— 上个月用它的那些训练在肌群统计/恢复里照旧算数。真删的话,
 *      删一个动作会让历史账目凭空少掉几周的量,而且**不报错**。
 */
import Taro from '@tarojs/taro';
// 相对路径:engine 模块要被 scripts/smoke-*.mjs 单独编译跑,纯 tsc 不认 '@/' 别名
import { markTouched } from '../../utils/sync-marks';
import { BODYPART_ZH, EQUIPMENT_ZH, MUSCLE_ZH, type ExerciseEntry } from '../data/exercises';

const K_CUSTOM = 'bodyos.training.custom';

/** 名字长度上限 —— 动作名就该短:训练页那一行要放得下「4 组 × 8-12 次 · 60kg · 休 1:30」 */
export const NAME_MAX = 24;
/** 最多留几个。收藏的上限是 100(engine/fav.ts),这里放宽些:一个人的自定义动作不该有几十个,
 *  但也不该被一个随手定的数字卡住 —— 这个上限是防脏数据把 storage 和同步撑爆的,不是产品规则。 */
export const CUSTOM_CAP = 200;

export interface CustomExercise {
  /** `c-` + 8 位 —— 和动作库那套 4 位数字 id 天然分得开,永远不会撞 */
  id: string;
  /** 用户起的名字(中文为主) */
  name: string;
  /** 部位:`BODYPART_ZH` 的 key(决定肌群统计分组、推拉平衡、换动作候选) */
  bodyPart: string;
  /** 器械:`EQUIPMENT_ZH` 的 key(决定重量怎么念:自重 / 助力 / 附加重量 / 负重) */
  equipment: string;
  /** 主要肌群,`''` = 不指明(和库里那些颈部/有氧动作一样,不进七个大组的统计) */
  target: string;
  /** 次要肌群(按 0.5 组折算,见 engine/muscles.ts) */
  secondary: string[];
  /** 是不是单侧(次数按两侧合计记、显示时折半,见 engine/sided.ts) */
  sided: boolean;
  /** 是不是助力器械(数字是器械替你分担的力,越大越轻松,见 engine/load.ts) */
  assisted: boolean;
  /** 是不是计时型(平板支撑、靠墙静蹲这类按时长而不是次数记的,见 engine/timed.ts) */
  timed: boolean;
  createdAt: string;
  /** 退场时间:设了就不再出现在任何选择列表,但历史与统计仍然认识这个 id */
  deletedAt?: string;
}

/**
 * 七个大组的「代表 key」—— 建自定义动作时让用户挑的就是这七个。
 * 它们同时满足两个条件:在 `MUSCLE_ZH` 里有中文名,在 `muscles.GROUP_OF` 里 1:1 归到对应大组。
 * 让用户从 57 个细 key 里挑(菱形肌?前锯肌?)既没意义,也一定会有人挑到一个
 * `GROUP_OF` 里没有的键 —— 那样这个动作会**悄悄**不进任何统计。七个键挑了必进。
 */
export const GROUP_MUSCLE_KEY: Record<string, string> = {
  chest: 'chest', back: 'back', shoulder: 'shoulders', arm: 'upper arms',
  core: 'waist', leg: 'upper legs', calf: 'lower legs'
};

/** 部位 → 默认的主要肌群(建动作时预选一个,用户可改;颈/有氧不给 —— 它们本来就不进那七个大组) */
export const MUSCLE_OF_BODYPART: Record<string, string> = {
  chest: 'chest', back: 'back', shoulders: 'shoulders',
  'upper arms': 'upper arms', 'lower arms': 'lower arms',
  waist: 'waist', 'upper legs': 'upper legs', 'lower legs': 'lower legs'
};

/** 可选的肌群 key(七个大组),给表单用 */
export const PICKABLE_MUSCLES: string[] = Object.keys(GROUP_MUSCLE_KEY).map((g) => GROUP_MUSCLE_KEY[g]);

/* ============================ 读写 ============================ */

let cache: CustomExercise[] | null = null;
/** 每一次写入 +1 —— 给 `patternPool` 那种「按库算一次就缓存」的地方当失效标记 */
let version = 0;

export function customVersion(): number {
  return version;
}

/**
 * 清洗:部位/器械认不出来的记录直接丢 —— 留着它,换动作候选与重量口径都会算在一个
 * 不存在的键上。读本机、云同步写回、备份导入三条路都过这一个函数(一处规则三处用)。
 */
export function sanitizeCustom(raw: unknown): CustomExercise[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomExercise[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX) : '';
    const bodyPart = typeof o.bodyPart === 'string' ? o.bodyPart : '';
    const equipment = typeof o.equipment === 'string' ? o.equipment : '';
    if (!id || !name || seen.has(id)) continue;
    if (!(bodyPart in BODYPART_ZH) || !(equipment in EQUIPMENT_ZH)) continue;
    const mus = (v: unknown): string[] => (Array.isArray(v)
      ? Array.from(new Set(v.filter((m): m is string => typeof m === 'string' && m in MUSCLE_ZH)))
      : []);
    const target = typeof o.target === 'string' && o.target in MUSCLE_ZH ? o.target : '';
    seen.add(id);
    out.push({
      id,
      name,
      bodyPart,
      equipment,
      target,
      secondary: mus(o.secondary).filter((m) => m !== target),
      sided: o.sided === true,
      assisted: o.assisted === true,
      timed: o.timed === true,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
      ...(typeof o.deletedAt === 'string' && o.deletedAt ? { deletedAt: o.deletedAt } : {})
    });
    if (out.length >= CUSTOM_CAP) break;
  }
  return out;
}

function read(): CustomExercise[] {
  if (!cache) cache = sanitizeCustom(Taro.getStorageSync(K_CUSTOM));
  return cache;
}

function write(list: CustomExercise[]): void {
  persist(list, true);
}

function persist(list: CustomExercise[], touched: boolean): void {
  cache = list;
  version++;   // 换动作候选那一池按它失效(见 generator.patternPool)
  Taro.setStorageSync(K_CUSTOM, list);
  if (touched) markTouched('custom', 'main');
}

/**
 * 整份覆盖(云同步/备份写回用)—— 写完由调用方用文档自己的时间戳盖回去,
 * 所以这里**不记修改时间**(和 store.saveNotes 同一个道理,不然本机会永远比云端新)。
 * 脏数据在这里也过一遍清洗,同步下来的东西落不了地。
 */
export function saveCustom(raw: unknown): void {
  persist(sanitizeCustom(raw), false);
}

/** 全部(含已退场的)—— 认 id 用(历史日志里的动作要认得出名字、部位、肌群) */
export function allCustom(): CustomExercise[] {
  return read();
}

/** 现在还在用的(不含已退场)—— 所有给用户挑的地方都走这个 */
export function listCustom(): CustomExercise[] {
  return read().filter((c) => !c.deletedAt);
}

/** id → 记录。这个查找在渲染里会被叫很多次(每个动作每次 `findExercise` 都问一次),
 *  所以按数组的**引用**缓存一份索引:写入时整份换掉,引用一变索引就重建。 */
let index: { src: CustomExercise[]; map: Map<string, CustomExercise> } | null = null;

/** 按 id 找(含已退场):口径层(`findExercise`/`isSided`/`isAssisted`)都从这里问 */
export function findCustom(id: string): CustomExercise | undefined {
  const list = read();
  if (!index || index.src !== list) index = { src: list, map: new Map(list.map((c) => [c.id, c])) };
  return index.map.get(id);
}

/**
 * 这个 id 是不是自定义动作 —— 看前缀就够了(`newId` 保证了这一点,动作库那套是 4 位数字),
 * 而且**退场的也算**:这里问的是身份,不是「现在还能不能挑」。
 */
export const isCustomId = (id: string): boolean => id.startsWith('c-');

/** 换成动作库那个形状 —— 认得出 id 的每一层就都能认它(见文件头) */
export function asEntry(c: CustomExercise): ExerciseEntry {
  return {
    id: c.id,
    // 用户起的名字只有一个,没有英文原名(详情弹层那行英文名对空串不显示)
    name: '',
    nameZh: c.name,
    bodyPart: c.bodyPart,
    equipment: c.equipment,
    target: c.target,
    secondary: c.secondary,
    // 分类/难度/发力/结构是动作库那套「编排」用的属性:自定义动作不参与自动编排(见 gen)
    category: '',
    level: '',
    force: '',
    mechanic: '',
    steps: []
  };
}

/** 还在用的那些,直接换成动作库形状(动作库页/选动作的列表用) */
export function customEntries(): ExerciseEntry[] {
  return listCustom().map(asEntry);
}

/* ============================ 增删改 ============================ */

export interface CustomDraft {
  name: string;
  bodyPart: string;
  equipment: string;
  target?: string;
  secondary?: string[];
  sided?: boolean;
  assisted?: boolean;
  timed?: boolean;
}

export type CustomResult = { ok: true; ex: CustomExercise } | { ok: false; why: string };

/** 名字归一化后比 —— 「 我的推胸机 」和「我的推胸机」是同名 */
const nameKey = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase();

/**
 * 只跟**别的自定义动作**比重名,不跟动作库比。
 * 库里已经有「杠铃卧推」不代表你不能自己建一个同名的(你的可能就是那台器械的另一种叫法),
 * 而且按名字认动作时动作库优先(见 plan-text 的 findByText),不会因为这个撞出歧义。
 */
function dupName(list: CustomExercise[], name: string, exceptId?: string): boolean {
  const k = nameKey(name);
  return list.some((c) => !c.deletedAt && c.id !== exceptId && nameKey(c.name) === k);
}

function validate(draft: CustomDraft, exceptId?: string): string | null {
  const name = draft.name.trim();
  if (!name) return '给这个动作起个名字';
  if (name.length > NAME_MAX) return `名字太长了(最多 ${NAME_MAX} 个字)`;
  if (!(draft.bodyPart in BODYPART_ZH)) return '选一个部位';
  if (!(draft.equipment in EQUIPMENT_ZH)) return '选一种器械';
  if (dupName(read(), name, exceptId)) return `已经有一个叫「${name}」的动作了`;
  return null;
}

/** 新 id —— 随机 8 位并避开已用的(不用时间戳:同一毫秒里连建两个会撞,见 M4.2 的教训) */
function newId(): string {
  const A = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const used = new Set(read().map((c) => c.id));
  for (;;) {
    let s = '';
    for (let i = 0; i < 8; i++) s += A[Math.floor(Math.random() * A.length)];
    const id = `c-${s}`;
    if (!used.has(id)) return id;
  }
}

function draftFields(draft: CustomDraft) {
  const target = draft.target && draft.target in MUSCLE_ZH ? draft.target : '';
  const secondary = Array.from(new Set((draft.secondary ?? []).filter((m) => m in MUSCLE_ZH && m !== target)));
  return {
    target, secondary,
    sided: draft.sided === true, assisted: draft.assisted === true, timed: draft.timed === true
  };
}

export function addCustom(draft: CustomDraft): CustomResult {
  const why = validate(draft);
  if (why) return { ok: false, why };
  const list = read();
  if (list.filter((c) => !c.deletedAt).length >= CUSTOM_CAP) {
    return { ok: false, why: `最多只能有 ${CUSTOM_CAP} 个自定义动作` };
  }
  const ex: CustomExercise = {
    id: newId(),
    name: draft.name.trim(),
    bodyPart: draft.bodyPart,
    equipment: draft.equipment,
    ...draftFields(draft),
    createdAt: new Date().toISOString()
  };
  write([ex, ...list]);
  return { ok: true, ex };
}

export function updateCustom(id: string, draft: CustomDraft): CustomResult {
  const cur = findCustom(id);
  if (!cur) return { ok: false, why: '这个动作已经不在了' };
  const why = validate(draft, id);
  if (why) return { ok: false, why };
  const next: CustomExercise = {
    ...cur,
    name: draft.name.trim(),
    bodyPart: draft.bodyPart,
    equipment: draft.equipment,
    ...draftFields(draft)
  };
  write(read().map((c) => (c.id === id ? next : c)));
  return { ok: true, ex: next };
}

/**
 * 退场 —— 从所有选择列表里消失,**但记录留着**。
 * 留着不是为了「撤销」,是为了历史:上个月用它的那些训练还要在肌群统计与恢复里算数,
 * 老计划里那一行也还认得出名字(动作库页不再列它,按 id 的历史照旧)。
 * 幂等:已经退场的再删一次不写盘(免得白推一次同步)。
 */
export function retireCustom(id: string): boolean {
  const cur = findCustom(id);
  if (!cur || cur.deletedAt) return false;
  write(read().map((c) => (c.id === id ? { ...c, deletedAt: new Date().toISOString() } : c)));
  return true;
}

/** 撤销退场(删除后的「撤销」入口用) */
export function reviveCustom(id: string): boolean {
  const cur = findCustom(id);
  if (!cur || !cur.deletedAt) return false;
  const { deletedAt: _drop, ...rest } = cur;
  write(read().map((c) => (c.id === id ? rest : c)));
  return true;
}
