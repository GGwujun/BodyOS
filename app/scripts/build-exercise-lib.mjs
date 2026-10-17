#!/usr/bin/env node
/**
 * 生成 app/src/data/exercises.ts(内置动作库)。
 *
 * 数据来源与授权详见同目录 THIRD-PARTY-NOTICES.md:
 *   1. openGym catalogue 中 textSource==="exercisedb" 的条目(ExerciseDB v1,MIT):
 *      名称/器械/部位/肌群/分类/英文步骤。默认目录 DEFAULT_OPENGYM,可用 --opengym 覆盖。
 *   2. free-exercise-db 文本(wrkout/exercises.json,Unlicense):仅取 level/force/mechanic
 *      训练属性合并到同名条目;openGym 未覆盖的条目作为补充收录(不使用其任何图片)。
 *   3. exercise-zh-cache.json(translate-exercises.mjs 产出):中文名与中文步骤。
 *
 * openGym 目录缺失时退回 exercises-raw.json 英文快照重建(便于只重合并翻译);
 * 英文快照由本脚本写出,使翻译脚本不依赖 openGym 本地目录。
 *
 * 用法: node scripts/build-exercise-lib.mjs [--opengym <dir>] [--fxdb <file>] [--raw <file>] [--cache <file>]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OPENGYM = 'E:/winning/code/AI/openGym';
const DEFAULT_FXDB = resolve(HERE, 'fxdb-exercises.json'); // 已持久化到仓库(Unlicense 文本)
const DEFAULT_RAW = resolve(HERE, 'exercises-raw.json');
const DEFAULT_CACHE = resolve(HERE, 'exercise-zh-cache.json');
const OUT_TS = resolve(HERE, '../src/pkg-exercise/data/exercises.ts');
const OUT_META = resolve(HERE, '../src/data/exercise-meta.ts');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// ── 中文显示词表(枚举键与数据严格一致;显示顺序即 chips 顺序) ─────────────
const BODYPART_ZH = {
  chest: '胸', back: '背', shoulders: '肩', 'upper arms': '上臂', 'lower arms': '前臂',
  waist: '腰腹', 'upper legs': '大腿', 'lower legs': '小腿', neck: '颈部', cardio: '有氧',
};
const CATEGORY_ZH = {
  strength: '力量', calisthenics: '徒手', stretching: '拉伸', plyometrics: '爆发跳跃',
  isometric: '静力', cardio: '有氧', mobility: '灵活性', olympic: '奥举', yoga: '瑜伽',
  rehab: '康复', combat: '搏击',
};
const EQUIPMENT_ZH = {
  barbell: '杠铃', dumbbell: '哑铃', 'body weight': '自重', cable: '绳索机',
  'leverage machine': '固定器械', 'smith machine': '史密斯机', 'ez barbell': 'EZ曲杆',
  kettlebell: '壶铃', 'trap bar': '六角杠', 'olympic barbell': '奥举杠铃', band: '弹力带',
  'resistance band': '阻力带', rope: '绳索', weighted: '负重', assisted: '助力器械',
  'medicine ball': '药球', 'stability ball': '瑞士球', 'bosu ball': '波速球',
  'wheel roller': '健腹轮', 'sled machine': '雪橇机', roller: '泡沫轴', tire: '轮胎',
  hammer: '大锤', 'stationary bike': '动感单车', 'elliptical machine': '椭圆机',
  'stepmill machine': '爬楼机', 'skierg machine': '滑雪机', 'upper body ergometer': '上肢功率车',
  other: '其他',
};
const MUSCLE_ZH = {
  chest: '胸部', pectorals: '胸大肌', 'upper chest': '上胸',
  back: '背部', lats: '背阔肌', 'latissimus dorsi': '背阔肌', trapezius: '斜方肌', traps: '斜方肌',
  rhomboids: '菱形肌', 'lower back': '下背部', 'upper back': '上背部', 'levator scapulae': '肩胛提肌',
  spine: '脊柱', 'rear deltoids': '三角肌后束',
  shoulders: '肩部', deltoids: '三角肌', delts: '三角肌', 'rotator cuff': '肩袖', 'serratus anterior': '前锯肌',
  'upper arms': '上臂', biceps: '肱二头肌', triceps: '肱三头肌', brachialis: '肱肌',
  'lower arms': '前臂', forearms: '前臂', 'wrist extensors': '腕伸肌', 'wrist flexors': '腕屈肌',
  wrists: '腕部', 'grip muscles': '握力肌群',
  waist: '腰腹', abdominals: '腹肌', abs: '腹肌', 'lower abs': '下腹', obliques: '腹斜肌', core: '核心',
  'upper legs': '大腿', quadriceps: '股四头肌', quads: '股四头肌', hamstrings: '腘绳肌', glutes: '臀肌',
  'hip flexors': '髋屈肌', adductors: '内收肌群', abductors: '外展肌群', 'inner thighs': '大腿内侧', groin: '腹股沟',
  'lower legs': '小腿', calves: '小腿三头肌', soleus: '比目鱼肌', shins: '胫骨前肌',
  'ankle stabilizers': '踝稳定肌', ankles: '踝部', feet: '足部',
  neck: '颈部', 'sternocleidomastoid': '胸锁乳突肌',
  hands: '手部', 'cardiovascular system': '心肺',
};
const LEVEL_ZH = { beginner: '初级', intermediate: '中级', expert: '高级' };
const FORCE_ZH = { push: '推', pull: '拉', static: '静力' };
const MECHANIC_ZH = { compound: '复合', isolation: '孤立' };

// fxdb 器械词表 → openGym 器械枚举(fxdb 新增条目归一用)
const FX_EQ_MAP = {
  'body only': 'body weight', machine: 'leverage machine', other: 'other', 'foam roll': 'roller',
  kettlebells: 'kettlebell', dumbbell: 'dumbbell', cable: 'cable', barbell: 'barbell', bands: 'band',
  'medicine ball': 'medicine ball', 'exercise ball': 'stability ball', 'e-z curl bar': 'ez barbell',
};
// fxdb 主肌群 → bodyPart(仅 fxdb 属性条目的展示兜底用)

const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// 词集匹配用具词(器械词剥离后按剩余词集比对;alternating≈alternate)
const EQ_WORDS = new Set(['barbell', 'dumbbell', 'cable', 'bodyweight', 'body', 'weight', 'machine', 'leverage', 'smith', 'ez', 'kettlebell', 'kettlebells', 'band', 'bands', 'stationary', 'bike', 'exercise', 'stability', 'medicine', 'roller', 'rope', 'weighted', 'assisted', 'curl', 'bar', 'only']);
const STOP_WORDS = new Set(['the', 'on', 'with', 'a', 'an', 'and', 'of']);
const tokenKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  .filter(Boolean).map((t) => (t === 'alternating' ? 'alternate' : t))
  .filter((t) => !EQ_WORDS.has(t) && !STOP_WORDS.has(t)).sort().join(' ');

// ── 1. 构建英文数据集(openGym MIT 条目 + fxdb 属性合并/补充) ───────────────
function buildRaw(opengymDir, fxdbFile) {
  const catDir = resolve(opengymDir, 'catalogue/exercises');
  if (!existsSync(catDir)) throw new Error(`openGym catalogue 目录不存在: ${catDir}`);
  const entries = [];
  for (const f of readdirSync(catDir)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(resolve(catDir, f), 'utf8'));
    if (j.textSource !== 'exercisedb') continue; // 只取 MIT 授权条目
    entries.push({
      id: String(j.id),
      name: j.name,
      bodyPart: j.bodyPart,
      equipment: j.equipment,
      target: j.target || '',
      secondary: j.secondaryMuscles || [],
      category: j.category,
      level: '', force: '', mechanic: '',
      steps: j.instructions || [],
    });
  }

  // fxdb 与 openGym 的 exercisedb 集是 ExerciseDB 不同快照,命名体系分化大:
  // 大量 fxdb 条目是"同一动作的不同命名",直接收录会重复 → fxdb 仅用于
  // 合并 level/force/mechanic 训练属性,不收录新条目。匹配两级:
  //   ① 归一化全名精确匹配;
  //   ② 器械剥离后的词集匹配,且要求器械一致(防"弹力带版"错配"杠铃版"),
  //      唯一命中才合并;歧义或无命中一律放弃。
  let merged = 0, mergedByToken = 0, skipped = 0;
  if (fxdbFile && existsSync(fxdbFile)) {
    const fx = JSON.parse(readFileSync(fxdbFile, 'utf8'));
    const arr = Array.isArray(fx) ? fx : fx.exercises;
    const byName = new Map(entries.map((e) => [normKey(e.name), e]));
    const byToken = new Map();
    for (const e of entries) {
      const k = tokenKey(e.name);
      if (!byToken.has(k)) byToken.set(k, []);
      byToken.get(k).push(e);
    }
    for (const e of arr) {
      if (!e?.name || !e.instructions?.length) continue;
      const attach = (hit) => {
        hit.level = e.level || '';
        hit.force = e.force || '';
        hit.mechanic = e.mechanic || '';
      };
      const exact = byName.get(normKey(e.name));
      if (exact) { attach(exact); merged++; continue; }
      const fxEq = FX_EQ_MAP[e.equipment] ?? 'other';
      const cands = (byToken.get(tokenKey(e.name)) || []).filter((c) => c.equipment === fxEq);
      if (cands.length === 1) { attach(cands[0]); mergedByToken++; } else skipped++;
    }
  }
  return { entries, merged, mergedByToken, skipped };
}

// ── 2. 翻译缓存 ─────────────────────────────────────────────────────────
function loadCache(file) {
  if (!file || !existsSync(file)) return {};
  const c = JSON.parse(readFileSync(file, 'utf8'));
  return c && typeof c === 'object' ? c : {};
}

// ── 3. 生成 TS ──────────────────────────────────────────────────────────
const q = JSON.stringify; // 双引号序列化,防撇号转义遗漏
const bpOrder = Object.keys(BODYPART_ZH);

function emitTS(entries, zh) {
  const sorted = [...entries].sort((a, b) => {
    const d = bpOrder.indexOf(a.bodyPart) - bpOrder.indexOf(b.bodyPart);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
  let zhNamed = 0, zhStepped = 0;
  const lines = [];
  let lastBp = null;
  for (const e of sorted) {
    if (e.bodyPart !== lastBp) {
      const n = sorted.filter((x) => x.bodyPart === e.bodyPart).length;
      lines.push(`  // ── ${BODYPART_ZH[e.bodyPart] ?? e.bodyPart}(${e.bodyPart}) ${n} 条 ──`);
      lastBp = e.bodyPart;
    }
    const z = zh[e.id];
    const nameZh = z?.name || e.name;
    const steps = Array.isArray(z?.steps) && z.steps.length ? z.steps : e.steps;
    if (z?.name) zhNamed++;
    if (Array.isArray(z?.steps) && z.steps.length) zhStepped++;
    lines.push(
      `  { id: ${q(e.id)}, name: ${q(e.name)}, nameZh: ${q(nameZh)}, bodyPart: ${q(e.bodyPart)}, ` +
      `equipment: ${q(e.equipment)}, target: ${q(e.target)}, secondary: ${JSON.stringify(e.secondary)}, ` +
      `category: ${q(e.category)}, level: ${q(e.level)}, force: ${q(e.force)}, mechanic: ${q(e.mechanic)}, steps: ${JSON.stringify(steps)} },`
    );
  }
  const header = `/**
 * 内置动作库 — 由 app/scripts/build-exercise-lib.mjs 自动生成,请勿手改。
 * 数据来源与授权见 app/scripts/THIRD-PARTY-NOTICES.md(ExerciseDB v1 MIT 文本 + free-exercise-db Unlicense 属性)。
 * 中文(nameZh/steps)由 translate-exercise-lib 的缓存合并,未翻译条目暂为英文。
 * 重新生成:node scripts/build-exercise-lib.mjs
 */

export interface ExerciseEntry {
  id: string;          // 稳定 id(openGym catalogue 数字 id)
  name: string;        // 英文原名(检索与溯源)
  nameZh: string;      // 中文名
  bodyPart: string;    // 部位,显示走 BODYPART_ZH
  equipment: string;   // 器械,显示走 EQUIPMENT_ZH
  target: string;      // 主要肌群,显示走 MUSCLE_ZH
  secondary: string[]; // 次要肌群
  category: string;    // 分类,显示走 CATEGORY_ZH
  level: '' | 'beginner' | 'intermediate' | 'expert';
  force: '' | 'push' | 'pull' | 'static';
  mechanic: '' | 'compound' | 'isolation';
  steps: string[];     // 动作步骤
}

/** 器械中文(顺序即筛选 chips 顺序) */
export const EQUIPMENT_ZH = ${JSON.stringify(EQUIPMENT_ZH, null, 2)} as const;
/** 部位中文(顺序即分组顺序) */
export const BODYPART_ZH = ${JSON.stringify(BODYPART_ZH, null, 2)} as const;
/** 分类中文 */
export const CATEGORY_ZH = ${JSON.stringify(CATEGORY_ZH, null, 2)} as const;
/** 肌群中文 */
export const MUSCLE_ZH = ${JSON.stringify(MUSCLE_ZH, null, 2)} as const;
/** 难度/发力/复合孤立 */
export const LEVEL_ZH = ${JSON.stringify(LEVEL_ZH)} as const;
export const FORCE_ZH = ${JSON.stringify(FORCE_ZH)} as const;
export const MECHANIC_ZH = ${JSON.stringify(MECHANIC_ZH)} as const;

export const EXERCISES: ExerciseEntry[] = [
`;
  const footer = `];
`;
  return { text: header + lines.join('\n') + '\n' + footer, zhNamed, zhStepped };
}

// ── main ────────────────────────────────────────────────────────────────
const opengymDir = arg('opengym') ?? DEFAULT_OPENGYM;
const fxdbFile = arg('fxdb') ?? DEFAULT_FXDB;
const rawFile = arg('raw') ?? DEFAULT_RAW;
const cacheFile = arg('cache') ?? DEFAULT_CACHE;

let entries, stats = { merged: 0, added: 0, fromSnapshot: false };
if (existsSync(resolve(opengymDir, 'catalogue/exercises'))) {
  const r = buildRaw(opengymDir, fxdbFile);
  entries = r.entries; stats = r;
  writeFileSync(rawFile, JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 0), 'utf8');
} else if (existsSync(rawFile)) {
  entries = JSON.parse(readFileSync(rawFile, 'utf8')).entries;
  stats.fromSnapshot = true;
  console.log(`[build] openGym 目录不可用,使用英文快照 ${rawFile}`);
} else {
  throw new Error(`找不到 openGym 目录(${opengymDir})且无英文快照。用法:node scripts/build-exercise-lib.mjs --opengym <dir>`);
}

const zh = loadCache(cacheFile);
const { text, zhNamed, zhStepped } = emitTS(entries, zh);
mkdirSync(dirname(OUT_TS), { recursive: true });
writeFileSync(OUT_TS, text, 'utf8');
// 主包用轻量元信息(避免主包页面 import 全量数据撑爆 2MB 主包限制)
writeFileSync(OUT_META, `/** 自动生成(build-exercise-lib.mjs),勿手改;动作全量数据在 pkg-exercise 分包 */\nexport const EXERCISE_META = { count: ${entries.length}, updated: '${new Date().toISOString().slice(0, 10)}' } as const;\n`, 'utf8');

const withAttrs = entries.filter((e) => e.level || e.force || e.mechanic).length;
console.log(`[build] 条目总数 ${entries.length}(全部为 openGym catalogue MIT 条目,fxdb 不再收录新条目)`);
console.log(`[build] fxdb 属性合并:精确 ${stats.merged} 条 + 词集(器械一致) ${stats.mergedByToken} 条,放弃 ${stats.skipped} 条;带训练属性 ${withAttrs} 条`);
console.log(`[build] 中文已覆盖:名称 ${zhNamed}/${entries.length},步骤 ${zhStepped}/${entries.length}`);
console.log(`[build] 写出 ${OUT_TS}(${(text.length / 1024).toFixed(0)} KB)`);
