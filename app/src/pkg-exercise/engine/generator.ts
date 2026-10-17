/**
 * 计划生成器 — 把分化模板的槽位翻译成动作库里的具体动作。
 * 全部打分确定性排序(无随机),同配置永远生成同一份计划,便于测试与回归。
 */
import { EXERCISES, type ExerciseEntry } from '../data/exercises';
import { asEntry, customEntries, customVersion, findCustom } from './custom';
import {
  PATTERNS, ACCESS_EQUIP, buildSplit, schemeFor, slotKind, trimPatterns, type Pattern
} from './patterns';
import { isAssisted } from './load';
import { isSided } from './sided';
import { HOLD_RANGE, isTimed } from './timed';
import {
  evenReps, type EquipAccess, type Goal, type Level, type PlanDay, type PlannedExercise,
  type ProgressionKind, type TrainingPlan
} from './types';

/** 不参与编排的类别(拉伸/康复等有专门入口,搏击/瑜伽与力量编排目标不符) */
const EXCLUDED_CATEGORY = new Set(['stretching', 'mobility', 'yoga', 'rehab', 'combat']);
/** 不稳定平面器械 — 不作为主项(新手风险高) */
const UNSTABLE_EQUIP = new Set(['stability ball', 'bosu ball', 'roller', 'wheel roller']);
/**
 * 危险/技巧门槛动作 — 直接排除:
 * 断头台卧推与颈后推(肩颈风险)、双力臂/借力/单臂引体/_planche/手倒立/手枪深蹲(专家技巧,不是计划素材)
 */
const EXCLUDE_NAME = /guillotine|behind the neck|muscle up|kipping|planche|handstand|pistol|one arm chin|one arm pull|rear pull|颈后|倒立|单臂引体/i;
/** 悬挂带类动作 — 扣分(对多数居家用户不可用) */
const SUSPENDED_NAME = /suspended|strap/i;
/** 模式语义关键词 — 命中加分(名称与模式对口的优先;force/mechanic 只有约 1/5 条目有) */
const PATTERN_KEYWORD: Record<string, RegExp> = {
  squat: /squat|deep knee|深蹲/i,
  hinge: /deadlift|hip|glute|bridge|good morning|hyperextension|硬拉|臀/i,
  lunge: /lunge|step[- ]?up|split squat|side squat|弓步|箭步/i,
  calf: /calf|heel raise|toe|提踵/i,
  hpush: /press|push[- ]?up|dip machine|俯卧撑|卧推/i,
  vpush: /press|push/i,
  fly: /fly|crossover|夹胸|飞鸟/i,
  hpull: /row|划船/i,
  vpull: /pull[- ]?up|pulldown|chin|straight arm|引体|下拉/i,
  rfly: /rear delt|reverse fly|lateral raise|side.?later|平举|后束/i,
  curl: /curl|弯举/i,
  tri: /extension|dip|kickback|press down|pushdown|屈伸|下压/i,
  core: /crunch|plank|twist|sit[- ]?up|leg raise|knee raise|russian|side bend|卷腹|平板|转体|举腿/i,
  swing: /swing|clean|snatch|high pull|摆/i,
  finisher: /burpee|jump|jack|mountain|climber|run|skip|rope|跳|跑/i
};

/**
 * id → 动作查找(UI 换动作/展示备选用)。
 * **自定义动作也是动作**(见 engine/custom.ts):先问它 —— 它那份元数据比动作库更可信
 * (单侧/助力是用户勾的),而且按 id 走的口径(肌群统计、恢复、重量怎么说)全都经过这里,
 * 于是「用户自己建的动作」和库里的动作在整条链路上没有区别。
 * id 空间天然分得开(`c-` 前缀 vs 4 位数字),谁先问都一样。
 */
const BY_ID = new Map<string, ExerciseEntry>(EXERCISES.map((e) => [e.id, e]));
export const findExercise = (id: string): ExerciseEntry | undefined => {
  const c = findCustom(id);
  return c ? asEntry(c) : BY_ID.get(id);
};

interface GenOptions {
  goal: Goal;
  level: Level;
  access: EquipAccess;
  daysPerWeek: number;
  sessionMin: number;
}

/** 单动作打分 — 越高越优先 */
function scoreEntry(e: ExerciseEntry, pat: Pattern, level: Level): number {
  if (EXCLUDE_NAME.test(e.name) || EXCLUDE_NAME.test(e.nameZh)) return -999;
  let s = 0;
  // 名称与模式语义对口(主判据)
  if (PATTERN_KEYWORD[pat.id]?.test(e.name) || PATTERN_KEYWORD[pat.id]?.test(e.nameZh)) s += 2.5;
  if (SUSPENDED_NAME.test(e.name) || SUSPENDED_NAME.test(e.nameZh)) s -= 3;
  // 类别:力量/徒手是编排主力
  if (e.category === 'strength' || e.category === 'calisthenics') s += 3;
  else if (e.category === 'olympic' && pat.prefersCompound) s += 1; // 壶铃摆荡类
  else if (e.category === 'plyometrics') s += pat.id === 'finisher' ? 3 : -1;
  else if (e.category === 'cardio') s += pat.id === 'finisher' ? 3 : -2;
  else if (e.category === 'isometric') s += pat.id === 'core' ? 2 : -1;
  // 发力方向与机械结构(部分条目有属性)
  if (pat.force && e.force === pat.force) s += 3;
  if (pat.prefersCompound) s += e.mechanic === 'compound' ? 3 : 0;
  else s += e.mechanic === 'isolation' ? 2 : 0;
  // 难度适配
  if (level === 'beginner') {
    s += e.level === 'beginner' ? 3 : e.level === 'intermediate' ? 1 : e.level === 'expert' ? -5 : 1;
  } else {
    s += e.level === 'beginner' ? 1 : e.level === 'intermediate' ? 2 : e.level === 'expert' ? -2 : 1;
  }
  // 器械偏好(如健身房深蹲优先杠铃)
  if (pat.prefEq?.includes(e.equipment)) s += 2;
  // 徒手垂直推兜底:下斜/派克类俯卧撑最接近肩推
  if (pat.id === 'vpush' && e.equipment === 'body weight'
    && /decline|elevated|pike/i.test(e.name)) s += 2;
  // 不稳定平面扣分
  if (UNSTABLE_EQUIP.has(e.equipment)) s -= 3;
  return s;
}

/** 该模式下可用的候选(按打分降序,确定性) */
function candidates(pat: Pattern, opts: GenOptions): ExerciseEntry[] {
  const allow = ACCESS_EQUIP[opts.access];
  const list = EXERCISES.filter((e) =>
    allow.has(e.equipment)
    && pat.bodyParts.includes(e.bodyPart)
    && e.bodyPart !== 'neck'
    && !(pat.id !== 'finisher' && e.bodyPart === 'cardio')
    && !(EXCLUDED_CATEGORY.has(e.category) && !(e.category === 'isometric' && pat.id === 'core'))
  );
  return list
    .map((e, i) => ({ e, s: scoreEntry(e, pat, opts.level) - i * 1e-4 })) // 稳定 tiebreak
    .filter((x) => x.s > -100) // 排除危险/技巧门槛动作
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e);
}

/**
 * 器械 → 渐进方式/起始负重/加重步长。
 * 有一定经验的人练器械/杠铃时给「三阶渐进」(次数推满 → 加组 → 才加重)——
 * 新手期线性加重涨得快、正反馈强,过了新手期再一味加重量就容易卡住。
 */
function progressionFor(eq: string, level: Level = 'beginner'): { kind: ProgressionKind; start: number | null; step: number } {
  const mid = level === 'intermediate';
  switch (eq) {
    case 'barbell':
    case 'olympic barbell':
    case 'trap bar': return { kind: mid ? 'triple' : 'linear', start: 15, step: 2.5 };
    case 'ez barbell': return { kind: mid ? 'triple' : 'linear', start: 10, step: 2.5 };
    case 'dumbbell': return { kind: 'double', start: 5, step: 2 };
    case 'kettlebell': return { kind: 'double', start: 8, step: 4 };
    case 'cable': return { kind: mid ? 'triple' : 'linear', start: 10, step: 2.5 };
    case 'smith machine':
    case 'leverage machine': return { kind: mid ? 'triple' : 'linear', start: 15, step: 2.5 };
    case 'weighted': return { kind: 'linear', start: 5, step: 2.5 };
    default: return { kind: 'ladder', start: null, step: 0 }; // 徒手/弹力带等 — 次数阶梯
  }
}

const WEIGHT_EQUIP = new Set([
  'barbell', 'olympic barbell', 'trap bar', 'ez barbell', 'dumbbell', 'kettlebell',
  'cable', 'smith machine', 'leverage machine', 'weighted'
]);

/** 估算单堂时长:热身 5 分钟 + 每组 35s 动作 + 组间休息 */
export function estMinutes(items: PlannedExercise[]): number {
  // 计时项按它自己的处方秒数算,不能套那个 35 秒的常数 —— 一组 90 秒平板和一组 35 秒
  // 卧推差了一倍多,套错的话「单次约 45 分钟」会在核心多的日子上明显偏短
  const sec = items.reduce((acc, it) => {
    const work = it.holdSec ? it.holdSec.max : 35;
    return acc + it.sets * (work + it.restSec);
  }, 0);
  return Math.round((5 * 60 + sec) / 60 / 5) * 5;
}

/** 该模式下、该器械条件下可用的动作(计划编辑器换动作/加动作用,顺序同生成器) */
/**
 * 动作 → 最贴近的模式(导入外部计划时用)。
 *
 * 计划文字里只写了动作(那是人和人之间能传的那一半),模式是 BodyOS 内部的槽位概念,
 * 得自己认回来 —— 认错了不会报错,只会让这个动作的「换动作」列表跑到别的部位去
 * (把卧推的候选给成练腿的)。判据就是生成器自己那套打分 `scoreEntry`,不另写一份:
 * 先在**同一部位**的模式里挑分最高的,再退到全部模式,免得出现「练腿的动作配了练胸的槽位」。
 */
export function bestPatternOf(exerciseId: string, level: Level = 'beginner'): string {
  const ex = findExercise(exerciseId);
  const all = Object.keys(PATTERNS);
  if (!ex) return 'hpush';
  const samePart = all.filter((id) => PATTERNS[id].bodyParts.includes(ex.bodyPart));
  const pool = samePart.length ? samePart : all;
  let best = pool[0];
  let bestScore = -Infinity;
  for (const id of pool) {
    const s = scoreEntry(ex, PATTERNS[id], level);
    if (s > bestScore) { bestScore = s; best = id; }
  }
  return best;
}

export function candidatesFor(patternId: string, access: EquipAccess, level: Level): ExerciseEntry[] {
  const pat = PATTERNS[patternId];
  if (!pat) return [];
  return candidates(pat, { goal: 'muscle', level, access, daysPerWeek: 3, sessionMin: 45 });
}

/** 模式 → 候选动作 的缓存(键为器械条件+水平)— 计划编排与训练中换动作共用,避免重复打分。
 *  缓存里多带一个 `v`(自定义动作的版本号):用户新建/删掉一个动作后这一池要重算,
 *  否则新动作在「换动作」里要等下次冷启动才出现。 */
const POOL_CACHE = new Map<string, { v: number; byPat: Record<string, ExerciseEntry[]> }>();
export function patternPool(access: EquipAccess, level: Level): Record<string, ExerciseEntry[]> {
  const k = `${access}|${level}`;
  let hit = POOL_CACHE.get(k);
  if (!hit || hit.v !== customVersion()) {
    const byPat: Record<string, ExerciseEntry[]> = {};
    for (const pid of Object.keys(PATTERNS)) byPat[pid] = candidatesFor(pid, access, level);
    // 自定义动作接在各自模式的候选表**后面**。两条规矩:
    //   ① 器械条件按计划那档筛(和动作库同一个判据)—— 计划写着「徒手」却推一个杠铃动作
    //      给他换,换完还是做不了;② 排在库里那些之后,它是「我另有的选择」,
    //      不该把编排挑出来的首选挤下去(要优先自己常练的,那是收藏干的事)。
    for (const e of customEntries()) {
      if (!ACCESS_EQUIP[access].has(e.equipment)) continue;
      const pid = bestPatternOf(e.id, level);
      byPat[pid] = [...(byPat[pid] ?? []), e];
    }
    hit = { v: customVersion(), byPat };
    POOL_CACHE.set(k, hit);
  }
  return hit.byPat;
}

/**
 * 单侧动作的次数口径(见 engine/sided.ts):计划里存**两侧合计**,显示时折成每侧。
 * 方案表里的次数是按单侧写的(「每侧 8-12 次」才是弓步的自然处方),所以这里翻成合计,
 * 并取整到偶数 —— 总数是奇数就一定会有一侧少做一个。
 */
function sideScheme(exId: string, scheme: { repsMin: number; repsMax: number }) {
  if (!isSided(exId)) return { sided: false, repsMin: scheme.repsMin, repsMax: scheme.repsMax };
  return { sided: true, repsMin: evenReps(scheme.repsMin * 2), repsMax: evenReps(scheme.repsMax * 2) };
}

/**
 * 计时型动作的处方(见 engine/timed.ts):按时长而不是次数。
 *
 * `repsMin/repsMax` 对它**故意给 0** —— 秒数对这两个字段没有意义,给 0 是为了让
 * 任何一处漏改的显示一眼露馅(「3 组 × 0 次」),而不是显示一个看来合理的「8-12 次」,
 * 然后让用户真的去数次数。达标判断走 `holdSec`(见 progression.ts 的改动)。
 */
function holdScheme(exId: string, kind: 'main' | 'accessory' | 'core' | 'finisher') {
  if (!isTimed(exId)) return { holdSec: undefined, repsMin: 0, repsMax: 0, timed: false };
  // 核心与支撑类撑得久(平板支撑),搬运与抗旋转类短(农夫行走、帕洛夫推举)
  const range = HOLD_RANGE[kind === 'core' ? 'long' : 'short'];
  return { holdSec: { min: range.min, max: range.max }, repsMin: 0, repsMax: 0, timed: true };
}

/** 把一个动作库条目装进指定模式的槽位(编辑器加/换动作时用,规则与生成器一致) */
export function buildItem(patternId: string, ex: ExerciseEntry, goal: Goal, level: Level = 'beginner'): PlannedExercise {
  const scheme = schemeFor(goal, slotKind(patternId));
  const prog = progressionFor(ex.equipment, level);
  const weighted = WEIGHT_EQUIP.has(ex.equipment);
  // 助力器械:数字是器械帮你的力,「加重」等于变轻松 —— 只按次数渐进(见 engine/load.ts)
  const assisted = isAssisted(ex.id);
  const side = sideScheme(ex.id, scheme);
  const hold = holdScheme(ex.id, slotKind(patternId));
  return {
    exerciseId: ex.id,
    nameZh: ex.nameZh,
    patternId,
    sets: scheme.sets,
    repsMin: hold.timed ? 0 : side.repsMin,
    repsMax: hold.timed ? 0 : side.repsMax,
    holdSec: hold.holdSec,
    sided: hold.timed ? undefined : (side.sided ? true : undefined),
    restSec: scheme.restSec,
    progression: weighted && !assisted ? prog.kind : 'ladder',
    weightKg: weighted ? prog.start : null,
    weightStepKg: prog.step,
    alternates: [],
    setType: 'normal'
  };
}

/**
 * 新计划的头一句提示(计划页概要那行)。生成和**导入**都用这一句:
 * 导进来的计划重量是别人(或教练)写的处方,前 1-2 次一样得先摸出自己的合适重量 ——
 * 这话对两边都成立,所以只有一处措辞,不跟着各写各的。
 */
export const START_NOTE = '前 1-2 次训练用来摸索合适重量:能标准完成目标次数的最后重量,就是你的起点。';

export function generatePlan(opts: GenOptions): TrainingPlan {
  const used = new Set<string>();
  const days: PlanDay[] = buildSplit(opts.daysPerWeek, opts.level).map((tpl) => {
    // 减脂/体能目标在末尾追加有氧收尾槽位
    const withFinisher = opts.goal !== 'muscle' ? [...tpl.patterns, 'finisher'] : tpl.patterns;
    const patternIds = trimPatterns(withFinisher, opts.level, opts.sessionMin);
    const items: PlannedExercise[] = [];

    for (const pid of patternIds) {
      const pat = PATTERNS[pid];
      if (!pat) continue;
      const pool = candidates(pat, opts).filter((e) => !used.has(e.id));
      if (!pool.length) continue; // 该模式下无可用动作(如纯徒手没有肩后束) — 跳过槽位
      const [pick, ...rest] = pool;
      used.add(pick.id);
      const scheme = schemeFor(opts.goal, slotKind(pid));
      const prog = progressionFor(pick.equipment, opts.level);
      const side = sideScheme(pick.id, scheme);
      const hold = holdScheme(pick.id, slotKind(pid));
      const assisted = isAssisted(pick.id); // 助力器械按次数渐进,不按重量(见 buildItem)
      items.push({
        exerciseId: pick.id,
        nameZh: pick.nameZh,
        patternId: pid,
        sets: scheme.sets,
        repsMin: hold.timed ? 0 : side.repsMin,
        repsMax: hold.timed ? 0 : side.repsMax,
        holdSec: hold.holdSec,
        sided: hold.timed ? undefined : (side.sided ? true : undefined),
        restSec: scheme.restSec,
        progression: WEIGHT_EQUIP.has(pick.equipment) && !assisted ? prog.kind : 'ladder',
        weightKg: WEIGHT_EQUIP.has(pick.equipment) ? prog.start : null,
        weightStepKg: prog.step,
        alternates: rest.slice(0, 3).map((a) => a.id),
        setType: 'normal'
      });
    }
    return { key: tpl.key, title: tpl.title, focus: tpl.focus, estMin: estMinutes(items), items };
  }).filter((d) => d.items.length >= 2); // 完全掏空的日不输出

  return {
    id: `plan-${Date.now()}`,
    createdAt: new Date().toISOString(),
    goal: opts.goal,
    level: opts.level,
    access: opts.access,
    daysPerWeek: opts.daysPerWeek,
    sessionMin: opts.sessionMin,
    days,
    doneCount: 0,
    lastNote: START_NOTE
  };
}

export { PATTERNS };
