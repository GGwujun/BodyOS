/**
 * 计划的口头形态 —— 一份训练计划写成**一段人能看懂、也能粘回来**的文字。
 *
 * 为什么是文字而不是文件(openGym 的 `lib/plan-share.js` 是导出一个小 JSON 文件):
 * 小程序**发不出文件**给微信好友(只能分享一张卡片),而用户的出口永远只有剪贴板 ——
 * 贴进聊天窗口、贴进备忘录、发给教练。所以同一件事在这里只有一种形态:一段文字。
 * 它同时接住三件真实的事:
 *   · 把计划发给朋友 —— 他复制后粘进「计划分享」就能用;
 *   · 换计划之前先存一份自己的 —— BodyOS 只有一份计划,重新生成会把旧的顶掉;
 *   · 教练发来一份计划 —— 他手写、没有编号,也得读得出来。
 *
 * 三条规矩:
 *  ①**只带处方**。不带日志、不带体重、不带渐进状态、不带里程碑文案。
 *     别人的记录对你不成立,你的记录对别人更没有意义 —— 这一点和 openGym 的
 *     bundle 一致(它也只带 routines + 一周安排 + 自定义动作)。
 *  ②**每一处和别处的念法一致**。次数走 `sideRangeText`(「16-20 次(每侧 8-10)」)、
 *     重量走 `loadText`(自重 / 助力 30kg / +20kg)、休息走 `fmtDuration`(1:30,不是 90s)、
 *     渐进与组型走 `PROGRESSION_ZH` / `SETTYPE_ZH`。另拼一套的话,同一个处方在计划页
 *     和这段文字里会长得不一样,而「看起来不一样」的下场就是用户以为哪里算错了。
 *  ③**导出的文字必须原样导得回来**。所以动作带一个 `(0025)` 这样的编号 ——
 *     1,324 条动作里重名的不少(「深蹲」类的变式一抓一把),光按名字认,
 *     导出再导入就可能换成另一个动作,而且**不报错**。编号对人也不是废物(像个货号)。
 *     手写的文字没有编号:那就按名字认,认不出来的一行不猜、直接报出来让人改。
 *     原样回来的是**处方**:组数、次数(含每侧)、重量、休息、渐进、组型、超级组、
 *     末组尽力 —— 这些逐字回来,一个不差。**「模式」不在其中**:它是 BodyOS 自己对
 *     这个动作的分类(靠动作库现算),只决定编辑器里那行小字和「换个动作」给哪些候选,
 *     不决定你今天练几组几公斤;而分类是**现算的**,所以「有氧收尾」这类槽位
 *     可能重算成「核心训练」。计划里别的机器字段同理:日期的 key 重发、`estMin`
 *     重算、`id`/`createdAt` 新发、周期回到第 1 周 —— 都不是处方。
 *
 * 文字长这样:
 * ```
 * BODYOS-计划-1
 * 减脂塑形 · 新手入门 · 健身房 · 每周 3 天 · 单堂 45 分钟
 *
 * 第 1 天 推 · 胸肩三头
 * 1 杠铃卧推 (0025) · 4 组 × 8-10 次 · 60kg · 休 1:30 · 线性加重
 * 2 哑铃侧平举 (0301) · 3 组 × 12-15 次 · 8kg · 休 1:00 · 双渐进 · 超级组 A
 * 3 哑铃前平举 (0302) · 3 组 × 12-15 次 · 8kg · 休 1:00 · 双渐进 · 超级组 A
 *
 * # 用 BodyOS 的「计划分享」粘进去就能导入
 * ```
 * `#` 开头的行是注释,读的时候直接跳过(手写时也能用它写两句给自己看)。
 */

import { EXERCISES, type ExerciseEntry } from '../data/exercises';
import { customEntries } from './custom';
import { CYCLE_ZH, type CycleStyle } from './cycle';
import { START_NOTE, bestPatternOf, buildItem, estMinutes, findExercise } from './generator';
import { loadText } from './load';
import { orderUnits } from './order';
import { SETTYPE_ZH, type SetType } from './settype';
import { rescaleReps } from './sided';
import { clampHoldSec, schemeText } from './timed';
import {
  ACCESS_ZH, GOAL_ZH, LEVEL_ZH, PROGRESSION_ZH,
  type EquipAccess, type Goal, type Level, type PlanDay, type PlannedExercise,
  type ProgressionKind, type TrainingPlan
} from './types';
import { clampRest, fmtDuration, parseDuration } from '../../utils/duration';

/** 文件头 —— 认不出来的文字靠它一眼分辨(和人手写的区别开),版本号比本机新就拒收 */
const MAGIC = 'BODYOS-计划-';
const FMT = 1;

/* --------------------------------- 写出去 --------------------------------- */

/** 一天的超级组编号:`orderUnits` 判出真成块的组,按出现顺序给 A/B/C;
 *  落单的组号(老计划里可能有的孤儿)不编号 —— 它本来就不是一个超级组。 */
function supersetLabels(items: PlannedExercise[]): Map<string, string> {
  const labels = new Map<string, string>();
  let n = 0;
  for (const unit of orderUnits(items)) {
    if (unit.length < 2) continue;
    const id = items[unit[0]]?.superset;
    if (id && !labels.has(id)) labels.set(id, String.fromCharCode(65 + n++));
  }
  return labels;
}

function itemLine(it: PlannedExercise, n: number, labels: Map<string, string>): string {
  const parts = [
    `${n} ${it.nameZh}${it.exerciseId ? ` (${it.exerciseId})` : ''}`,
    // 组次走 schemeText:计时项的次数是 0,照次数念会写出一句「3 组 × 0 次」——
    // 那不只是难看,导入时那一行会被 `parseReps` 判成读不懂(0 不是有效次数)整行丢掉
    schemeText(it),
    loadText(it.exerciseId, it.weightKg),
    // 休息 0 秒是一句真话(超级组之间不休息),不能因为「0 就不写」被读成「没设过、用默认」
    it.restSec > 0 ? `休 ${fmtDuration(it.restSec)}` : '不休息',
    PROGRESSION_ZH[it.progression]
  ];
  if (it.setType && it.setType !== 'normal') parts.push(SETTYPE_ZH[it.setType]);
  if (it.amrapLast) parts.push('末组尽力');
  const label = it.superset ? labels.get(it.superset) : undefined;
  if (label) parts.push(`超级组 ${label}`);
  return parts.join(' · ');
}

/** 配置行:目标 · 水平 · 器械条件 · 每周几天 · 单堂多久(+ 周期) */
function configLine(plan: TrainingPlan): string {
  const parts = [
    GOAL_ZH[plan.goal], LEVEL_ZH[plan.level], ACCESS_ZH[plan.access],
    `每周 ${plan.daysPerWeek} 天`, `单堂 ${plan.sessionMin} 分钟`
  ];
  if (plan.cycle) parts.push(`周期 ${CYCLE_ZH[plan.cycle.style]}`);
  return parts.join(' · ');
}

/**
 * 一份计划 → 一段文字。
 * 日期的编号(`第 1 天`)只是给人读的顺序;导入时一律重新发 key(见 `parsePlanText`)。
 */
export function planToText(plan: TrainingPlan): string {
  const lines: string[] = [`${MAGIC}${FMT}`, configLine(plan), ''];
  plan.days.forEach((d, i) => {
    const title = [d.title, d.focus].filter(Boolean).join(' · ');
    lines.push(`第 ${i + 1} 天${title ? ` ${title}` : ''}`);
    const labels = supersetLabels(d.items);
    d.items.forEach((it, j) => lines.push(itemLine(it, j + 1, labels)));
    lines.push('');
  });
  lines.push('# 用 BodyOS 的「计划分享」粘进去就能导入');
  return lines.join('\n');
}

/* --------------------------------- 读回来 --------------------------------- */

/** 一行认不出来的东西 —— 给界面用,要能指出「第几行的哪一句没读懂」 */
export interface TextIssue { line: number; text: string; why: string }

export interface PlanTextParse {
  /** 认出来的计划(认不出来就是 null);day key 一律重新发 */
  plan: TrainingPlan | null;
  days: number;
  items: number;
  /** 整行丢掉的动作(动作库认不出、或没写组次) */
  dropped: TextIssue[];
  /** 认出来了、但有词没看懂(手写计划里常有额外备注)—— 不致命,只是让用户知道 */
  notes: TextIssue[];
  /** plan 为 null 时的原因(一句人话) */
  reason?: string;
}

export interface ParseOpts {
  /** 配置行认不出来时用哪个目标/水平/器械 —— 页面传用户当前那份计划的,别凭空造 */
  fallback?: { goal: Goal; level: Level; access: EquipAccess };
  /** 本机时间(测试用) */
  now?: number;
}

const zhKeyOf = <T extends string>(map: Record<T, string>, text: string): T | null => {
  const t = text.trim();
  for (const k of Object.keys(map) as T[]) if (map[k] === t) return k;
  return null;
};

/** 去掉中文名里的括号限定:`杠铃深蹲（全蹲）` → `杠铃深蹲`(1,324 条里有 92 条带这种限定) */
const stripParen = (s: string) => s.replace(/[（(][^（()）]*[)）]/g, '').trim();

/** 动作库里的同名项:精确中文名/英文名 → 去掉括号限定后完全相同 → 唯一子串。
 *  **只在唯一时认** —— 「卧推」能配出十几个变式,猜一个就是悄悄换动作。
 *  中间那一档是给人写的计划留的:BodyOS 的中文名为了区分变式加了括号
 *  (「杠铃深蹲（全蹲）」「动态胸部拉伸(男)」),而人手写时只会写「杠铃深蹲」——
 *  不去掉这个括号,一句再普通不过的「杠铃深蹲」就认不出来了。去掉括号后**必须完全相同**,
 *  而且同样只在唯一时认(「X（版本1）」「X（版本2）」两条并列时照样不猜)。 */
function resolveIn(pool: readonly ExerciseEntry[], raw: string): ExerciseEntry | null {
  const lower = raw.toLowerCase();
  const exact = pool.filter((e) => e.nameZh === raw || (e.name && e.name.toLowerCase() === lower));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // 同名多个:不猜
  const bare = pool.filter((e) => stripParen(e.nameZh) === raw);
  if (bare.length === 1) return bare[0];
  if (bare.length > 1) return null;
  const partial = pool.filter((e) =>
    e.nameZh.includes(raw) || (e.name && e.name.toLowerCase().includes(lower)));
  return partial.length === 1 ? partial[0] : null;
}

/**
 * 按名字认:动作库优先,库里的认不出来再问**自己建的那些**(custom.ts)。
 * 顺序不能反:自定义动作只在这台设备上存在,而按名字认是人和人之间传计划的路子
 * (导出永远带编号,名字这条路是给人手写的),所以先按对谁都成立的那一份认 —— 也正因为这样,
 * 用户建了一个和库里同名的动作不会让老计划突然认不出来(那会变成「同名多个」)。
 */
function findByText(name: string): ExerciseEntry | null {
  const raw = name.trim();
  if (!raw) return null;
  return resolveIn(EXERCISES, raw) ?? resolveIn(customEntries(), raw);
}

/** `1 杠铃卧推 (0025)` 里那个编号 */
const RE_ID = /\(([A-Za-z0-9_-]{1,24})\)\s*$/;
/** `1 ` / `1.` / `1、` / `1)` 开头 */
const RE_ITEM_NO = /^\s*(\d+)\s*[.、)）]?\s+/;
/** `第 1 天 推 · 胸肩三头` / `Day 1: 推` */
const RE_DAY = /^(?:第\s*(\d+)\s*天|Day\s*(\d+))\s*[:：]?\s*(.*)$/i;
/** `4 组 × 8-10 次(每侧 4-5)` */
const RE_SETS = /^(\d+)\s*组?\s*[×xX*]\s*(.+)$/;

/** 重量那一格:`自重` / `60kg` / `助力 30kg` / `+20kg`(loadText 写出来的那几种) */
function parseWeight(tok: string): { weightKg: number | null } | null {
  const t = tok.trim();
  if (t === '自重' || t === '徒手') return { weightKg: null };
  const m = /\d+(?:\.\d+)?/.exec(t);
  if (!m) return null;
  // 「助力」和「+」只影响怎么说,数字怎么存是一样的(见 engine/load.ts)
  return { weightKg: Number(m[0]) };
}

/**
 * 计时那一格 → { min, max }(秒)。认导出形状(`保持 30-45 秒`),也认手写的
 * `保持 45 秒` / `45 秒` / `保持 1 分-1 分 30 秒`。
 *
 * **只看这一格里有没有「分/秒」** —— 次数型的格子永远写「次」,所以两者不会互相误认;
 * 而「休 30 秒」是**另一个词条**(`rest` 那一条先匹配),不会走到这里来。
 * 单位只写在后半段的那种(`30-45 秒`)要把单位补到前面去,否则「1-1.5 分」的
 * 前半段会被 `parseDuration` 当成 1 秒。
 */
function parseHold(rest: string): { min: number; max: number } | null {
  if (!/[分秒]/.test(rest)) return null;
  const body = rest.replace(/^保持\s*/, '').replace(/每侧|单侧|左右/g, '').trim();
  const parts = body.split(/\s*[-~～至到]\s*/).filter(Boolean);
  if (!parts.length) return null;
  const unit = /(分钟|分|秒)$/.exec(parts[parts.length - 1])?.[1] ?? '';
  const read = (t: string): number | null => parseDuration(/[分秒]/.test(t) ? t : `${t}${unit}`);
  const lo = read(parts[0]);
  if (lo == null) return null;
  const hi = parts.length > 1 ? read(parts[1]) : lo;
  // 区间不分前后:写「45-30 秒」的人是笔误,不是要一个倒过来的区间 —— 小的当下限
  const a = clampHoldSec(lo);
  const b = clampHoldSec(hi ?? lo);
  const min = Math.min(a, b);
  if (!(min > 0)) return null;
  return { min, max: Math.max(a, b) };
}

/** 次数那一格 → { repsMin, repsMax, sided }。
 *  两种写法都认:合计在前(`16-20 次(每侧 8-10)`,导出就是这个形状)、
 *  或者是整格都按每侧写的(`每侧 8-10 次`,人手写时最自然)。
 *  计时那一格(`保持 45 秒`)不走这里 —— `parseHold` 先接手。 */
function parseReps(rest: string): { repsMin: number; repsMax: number; sided: boolean } | null {
  const nums = rest.match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  const perSideFirst = /^(每侧|单侧|左右)/.test(rest.trim());
  const sided = perSideFirst || /每侧|单侧|左右/.test(rest);
  // 只取前两个数。合计在前时括号里的每侧只是同义重复,不能拿来当总量
  // (`16-20 次(每侧 8-10)` 的 8-10 是 16-20 折出来的,再折一次就变成 32-40)
  const lo = Number(nums[0]);
  const hi = nums.length > 1 ? Number(nums[1]) : lo;
  if (!(lo > 0) || !(hi > 0)) return null;
  const cap = (n: number) => Math.min(99, Math.round(n));
  // 整格按每侧写的那一种要折成合计 —— 折算走 sided.rescaleReps(那一处也负责取偶)
  const conv = (n: number) => (perSideFirst ? rescaleReps(n, true) : cap(n));
  return { repsMin: conv(lo), repsMax: conv(hi), sided };
}

/**
 * 配置行:「减脂塑形 · 新手入门 · 健身房 · 每周 3 天 · 单堂 45 分钟 [· 周期 …]」。
 * `hit` 是**认出来的格数** —— 一格都没认出来的一行不算配置行(那是前面的寒暄),
 * 否则一句「兄弟,这是我最近在用的计划」会被悄悄当成配置读掉,一个字都不报。
 * 认不出来的格照 `fallback` 走(页面传用户当前那份计划的设置:他本来就是那个目标、
 * 那个器械条件,拿别人的计划也多半还是)。
 */
function parseConfig(line: string, fallback: ParseOpts['fallback']) {
  const out = {
    goal: fallback?.goal ?? ('muscle' as Goal),
    level: fallback?.level ?? ('intermediate' as Level),
    access: fallback?.access ?? ('gym' as EquipAccess),
    daysPerWeek: 3,
    sessionMin: 45,
    cycle: null as CycleStyle | null,
    hit: 0
  };
  for (const tok of line.split('·').map((s) => s.trim())) {
    if (!tok) continue;
    const g = zhKeyOf(GOAL_ZH, tok); if (g) { out.goal = g; out.hit++; continue; }
    const l = zhKeyOf(LEVEL_ZH, tok); if (l) { out.level = l; out.hit++; continue; }
    const a = zhKeyOf(ACCESS_ZH, tok); if (a) { out.access = a; out.hit++; continue; }
    const days = /每周\s*(\d+)\s*天/.exec(tok);
    if (days) { out.daysPerWeek = Math.min(7, Math.max(1, Number(days[1]))); out.hit++; continue; }
    const min = /单堂\s*(\d+)\s*分钟/.exec(tok);
    if (min) { out.sessionMin = Math.min(180, Math.max(10, Number(min[1]))); out.hit++; continue; }
    const cy = /^周期\s*(.+)$/.exec(tok);
    if (cy) { const c = zhKeyOf(CYCLE_ZH, cy[1]); if (c) { out.cycle = c; out.hit++; } }
  }
  return out;
}

/** 一行动作 → 计划项;认不出来返回 why(给人看的一句话) */
function parseItem(
  line: string, goal: Goal, level: Level, ssIds: Map<string, string>
): { item: PlannedExercise; unknown: string[] } | { why: string } {
  const toks = line.split('·').map((s) => s.trim()).filter(Boolean);
  if (!toks.length) return { why: '这一行里没有动作(只有分隔符)' };
  const head = toks.shift() as string;
  const m = RE_ITEM_NO.exec(head);
  let namePart = m ? head.slice(m[0].length) : head;
  let id: string | null = null;
  const idHit = RE_ID.exec(namePart);
  if (idHit) { id = idHit[1]; namePart = namePart.slice(0, idHit.index).trim(); }
  const ex = id ? findExercise(id) ?? null : null;
  const known = ex ?? findByText(namePart);
  if (!known) {
    // 编号不在库里 —— 对方用了**他自己建的动作**(编号 c- 开头),或者这条计划来自别的版本。
    // 名字还在那一行里,所以照着名字说:人一眼就知道缺的是哪个动作,
    // 自己建一个同名的再粘一次就认了(名字认不出来时,也带着名字报,不然那头雾水)
    if (namePart) return { why: `认不出这个动作:「${namePart}」${id ? `(编号 ${id} 不在你的动作库里)` : ''}` };
    return { why: `动作库里没有编号 ${id}` };
  }

  const patternId = bestPatternOf(known.id, level);
  const base = buildItem(patternId, known, goal, level);
  const item: PlannedExercise = { ...base, nameZh: known.nameZh };

  const unknown: string[] = [];
  let reps: { repsMin: number; repsMax: number; sided: boolean } | null = null;
  let sawSets = false;
  for (const tok of toks) {
    const sets = RE_SETS.exec(tok);
    if (sets && !sawSets) {
      sawSets = true;
      // 组数上下限和计划编辑器那个步进器一致(1-10):别人的文件不该造出编辑器改不动的计划
      item.sets = Math.min(10, Math.max(1, Number(sets[1])));
      const hold = parseHold(sets[2]);
      if (hold) {
        // 文字里写了时长就以文字为准(哪怕动作库没把它算成计时型 —— 这是他的处方);
        // 反过来,库里算计时型但文字只写了次数时,`buildItem` 给的那份 holdSec 留着,
        // 次数则在下面照常读:用户可能真的按次数练过平板支撑,两边都留得住。
        item.holdSec = hold;
        item.repsMin = 0;
        item.repsMax = 0;
        // 次数是 0 的时候,单侧口径(「每侧折成合计」)没有东西可折 —— 清掉它,
        // 别让一个「每侧」在别的页面上把一组 0 次解读成两边的 0 次
        delete item.sided;
        // 秒数和单侧不是一种量:「每侧 30 秒」这里的 30 秒是**每侧**还是合计留不住,
        // 就把它当没看懂的词报上去,别悄悄吞掉(用户会在导入结果里看到这一格)
        if (/每侧|单侧|左右/.test(sets[2])) unknown.push(tok);
        continue;
      }
      const r = parseReps(sets[2]);
      if (!r) {
        // 全 0 的次数不是「没看懂」,是**计时项的占位值** —— 旧版导出就是「3 组 × 0 次」
        // (见 engine/generator.ts 的 holdScheme),说清楚该写什么形状比只说读不懂有用
        if (/[×xX*]\s*0\s*次/.test(tok)) {
          return { why: '这一行的次数是 0 —— 计时动作请写成「3 组 × 保持 45 秒」' };
        }
        return { why: `这一行的次数没读懂:「${tok}」` };
      }
      reps = r;
      continue;
    }
    if (/^(自重|徒手)$/.test(tok) || /^(?:助力\s*)?[+]?\d+(?:\.\d+)?\s*(?:kg|公斤)?$/.test(tok)) {
      const w = parseWeight(tok);
      if (w) { item.weightKg = w.weightKg; continue; }
    }
    if (/^不休息$/.test(tok)) { item.restSec = 0; continue; }
    const rest = /^休(?:息)?\s*(.+)$/.exec(tok);
    if (rest) {
      const sec = parseDuration(rest[1]);
      if (sec == null) return { why: `休息时间没读懂:「${tok}」` };
      item.restSec = clampRest(sec);
      continue;
    }
    const prog = zhKeyOf(PROGRESSION_ZH, tok) ?? (['linear', 'double', 'ladder', 'triple'] as const).find((k) => k === tok.toLowerCase());
    if (prog) { item.progression = prog as ProgressionKind; continue; }
    const st = zhKeyOf(SETTYPE_ZH, tok);
    if (st) { item.setType = st as SetType; continue; }
    if (tok === '末组尽力') { item.amrapLast = true; continue; }
    const sg = /^超级组(?:\s*([A-Za-z0-9]))?$/.exec(tok);
    if (sg) {
      const label = sg[1] ?? 'A';
      if (!ssIds.has(label)) ssIds.set(label, `ss-${label.toLowerCase()}`);
      item.superset = ssIds.get(label) as string;
      continue;
    }
    // 看不懂的词**不拦下这一行**:手写计划里常有「记得慢放,最后一组找个人保护」这类备注,
    // 为一句备注丢掉一组处方,对用户来说是净损失。收进 notes 里让他自己看。
    unknown.push(tok);
  }
  if (!sawSets) return { why: '没写组次(照「3 组 × 10 次」写)' };
  if (reps) {
    item.repsMin = reps.repsMin;
    item.repsMax = reps.repsMax;
    // 单侧与否**以文字为准**:写了「每侧」就是每侧(上面的 parseReps 会把次数折成合计),
    // 没写就按他写的数字原样存、当成总数。分腿蹲这种动作库判为单侧的也不例外 ——
    // 「10 次」写在分腿蹲后面,教练十有八九是「每条腿 10 次」,替他折半才是练少了。
    if (reps.sided) item.sided = true; else delete item.sided;
  }
  return { item, unknown };
}

/**
 * 把导入的天**加进**现有计划(默认那个动作,不动原来的任何一天)。
 *
 * 这里非要知道现有计划不可:解析出来的 key 是 `imp-1`、`imp-2`…,而你上一回导入
 * 的那几天**也叫这个**。不重发的话计划里就有两天共用 `imp-1`,而
 * 「照这次再来一遍」(`?key=`)是按键找到那一天的 —— 用户点「第一天」,
 * 练的可能是他三个月前导进来的另一份。openGym 合并计划时给 routine 重发 id
 * 是在防同一类事。
 */
export function addImportedDays(plan: TrainingPlan, days: readonly PlanDay[]): TrainingPlan {
  const used = new Set(plan.days.map((d) => d.key));
  const added = days.map((d) => {
    let key = d.key;
    for (let n = 2; used.has(key); n++) key = `${d.key}-${n}`;
    used.add(key);
    return key === d.key ? d : { ...d, key };
  });
  return {
    ...plan,
    days: [...plan.days, ...added],
    daysPerWeek: Math.min(7, plan.daysPerWeek + added.length)
  };
}

/**
 * 一段文字 → 一份计划。
 * **day key 一律重新发**(`imp-1`、`imp-2`…):别人写的 key 和你计划里的 key 撞上,
 * 会让「照这次再来一遍」这类按 key 找当天的入口指到错的那天;openGym 导出计划时
 * 给动作重发 id 也是同一个道理(「不让对方已有的东西被动到」)。
 * 加进现有计划时还要再避一次撞(见 `addImportedDays`)。
 */
export function parsePlanText(text: string, opts: ParseOpts = {}): PlanTextParse {
  const out: PlanTextParse = { plan: null, days: 0, items: 0, dropped: [], notes: [] };
  const lines = String(text ?? '').split(/\r?\n/);
  const dropped: TextIssue[] = out.dropped;
  const notes: TextIssue[] = out.notes;

  let fmt: number | null = null;
  let config: ReturnType<typeof parseConfig> | null = null;
  const days: PlanDay[] = [];
  let cur: PlanDay | null = null;
  let curLabels = new Map<string, string>();
  let dayNo = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const magic = new RegExp(`^${MAGIC}(\\d+)$`).exec(line);
    if (magic) { fmt = Number(magic[1]); continue; }
    const day = RE_DAY.exec(line);
    if (day) {
      dayNo++;
      // 标题里也可能带 ` · `(推 · 胸肩三头):第一段是日名,剩下的是重点
      const [title, ...rest] = day[3].split('·').map((s) => s.trim()).filter(Boolean);
      cur = {
        key: `imp-${dayNo}`,
        title: title || `第 ${dayNo} 天`,
        focus: rest.join(' · '),
        estMin: 0,
        items: []
      };
      days.push(cur);
      curLabels = new Map();
      continue;
    }
    // 配置行:紧跟在文件头后面、还不属于任何一天的那一行(一格都没认出来的不算)
    if (!cur && !config) {
      const cfg = parseConfig(line, opts.fallback);
      if (cfg.hit) { config = cfg; continue; }
    }
    if (!cur) { dropped.push({ line: i + 1, text: line, why: '这一行不在任何一天里(先写「第 1 天 …」)' }); continue; }
    const res = parseItem(line, config?.goal ?? 'muscle', config?.level ?? 'intermediate', curLabels);
    if ('why' in res) { dropped.push({ line: i + 1, text: line, why: res.why }); continue; }
    cur.items.push(res.item);
    if (res.unknown.length) {
      notes.push({ line: i + 1, text: res.unknown.join(' · '), why: `${res.item.nameZh}这一行有没看懂的词,已按认出来的部分导入` });
    }
  }

  if (fmt != null && fmt > FMT) {
    out.reason = '这份计划是更新版本的 BodyOS 写的,升级一下再用';
    return out;
  }
  const alive = days.filter((d) => d.items.length);
  if (!alive.length) {
    out.reason = config
      ? '这段文字里没读出计划 —— 是不是少了「第 1 天 推 · 胸肩三头」这样的行?'
      : '这段文字里没读出计划 —— 先粘一份从 BodyOS 复制出来的,或者照它的样子写';
    return out;
  }

  const now = opts.now ?? Date.now();
  out.plan = {
    id: `plan-imp-${now}`,
    createdAt: new Date(now).toISOString(),
    goal: config?.goal ?? 'muscle',
    level: config?.level ?? 'intermediate',
    access: config?.access ?? 'gym',
    daysPerWeek: config?.daysPerWeek ?? alive.length,
    sessionMin: config?.sessionMin ?? 45,
    // 周期一律从第 1 周开始:别人走到第几周跟你没关系,你还没陪他走过前三周
    ...(config?.cycle ? { cycle: { style: config.cycle, week: 1 } } : {}),
    days: alive.map((d) => ({ ...d, estMin: estMinutes(d.items) })),
    doneCount: 0,
    // 导进来的计划一样得先摸重量(文字里那个重量是别人的),所以用生成时那句提示
    lastNote: START_NOTE
  };
  out.days = alive.length;
  out.items = alive.reduce((n, d) => n + d.items.length, 0);
  return out;
}
