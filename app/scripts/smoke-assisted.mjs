/**
 * M10.6 重量口径(助力器械 / 负重自重)冒烟测试。
 *
 * 计划与日志里的 `weightKg` 只有一个数字,含义却随动作而变(见 engine/load.ts):
 *   · 负重:数字就是总负重,越重越强;
 *   · **助力**(助力引体向上这类):数字是器械替你分担的力,**越大越轻松**;
 *   · **附加重量**(负重引体/负重双杠):数字只是加在自身体重之上的那部分。
 *
 * 这套用例盯的是「助力不能当负重算」这一条 —— 它错起来最贵:
 *   人越练越弱,助力数字反而越大,于是「估 1RM」「力量基准」「力量保持」一起虚高,
 *   周期波次还会拿这个假基准去开 %1RM 的处方重量;渐进引擎则会一路「加重」,
 *   把动作越调越轻松,还告诉用户这是进步。
 * 另一条是显示口径:负重自重的数字要带 `+`,不然「20kg × 8」会被读成总负荷。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-assisted.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const mem = new Map();
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); }
};
const taroMock = { default: storage, ...storage };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return taroMock;
  return origLoad.call(this, req, ...rest);
};

const E = '../.smoke/pkg-exercise/engine/';
const L = require(`${E}load.js`);
const O = require(`${E}onerm.js`);
const H = require(`${E}history.js`);
const M = require(`${E}max.js`);
const ST = require(`${E}strength.js`);
const W = require(`${E}warmup.js`);
const G = require(`${E}generator.js`);
const ED = require(`${E}editor.js`);
const PROG = require(`${E}progression.js`);
const SC = require(`${E}share-card.js`);
const { EXERCISES } = require('../.smoke/pkg-exercise/data/exercises.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/* 用例里用到的真实动作(全部来自 1,324 条动作库) */
const ASSISTED_PULL = '0017';   // assisted pull-up — 助力引体向上,leverage machine
const ASSISTED_DIP = '0019';    // assisted triceps dip (kneeling)
const LEVER_CHEST = '0576';     // lever chest press — 普通器械推胸(也是 leverage machine!)
const BAND_ASSISTED = '0970';   // band assisted pull-up — 弹力带助力,不是负重器械
const CABLE_ASSISTED = '3235';  // cable assisted inverse leg curl
const SELF_ASSISTED = '0697';   // self assisted inverse leg curl — 徒手
const PARTNER = '0018';         // assisted standing triceps extension (with towel)
const WEIGHTED_PULL = '0841';   // weighted pull-up — 负重引体向上(数字是附加重量)
const BENCH = '0025';           // barbell bench press — 普通负重

const set = (reps, weightKg) => ({ reps, weightKg });
const done = (reps, weightKg) => ({ reps, weightKg, done: true, rir: 2 });
const logOf = (date, entries, extra = {}) => {
  const sets = entries.flatMap((e) => e.sets);
  return {
    id: `wo-${date}`, planId: 'p', dayKey: 'd1', dayTitle: '练', date,
    durationSec: 3600,
    totalSets: sets.length,
    totalReps: sets.reduce((n, s) => n + s.reps, 0),
    totalVolumeKg: O.round2(sets.reduce((n, s) => n + s.reps * (s.weightKg ?? 0), 0)),
    avgRir: null,
    entries,
    ...extra
  };
};
/** 造一个只含给定动作的计划(渐进/编辑器用例用) */
const planOf = (items) => ({
  id: 'p', createdAt: '', goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek: 1, sessionMin: 45, doneCount: 0, lastNote: '',
  days: [{ key: 'd1', title: '练', focus: '全身', estMin: 40, items }]
});
const planItem = (id, over = {}) => ({
  exerciseId: id, nameZh: G.findExercise(id)?.nameZh ?? id, patternId: 'vpull',
  sets: 3, repsMin: 8, repsMax: 12, restSec: 90,
  progression: 'ladder', weightKg: null, weightStepKg: 2.5,
  alternates: [], setType: 'normal', ...over
});

/* ================= 1. 判定:哪些动作算「助力器械」 ================= */
section('判定:助力器械 = leverage machine **且** 名字里带 assist');
ok('助力引体向上是助力器械', L.isAssisted(ASSISTED_PULL));
ok('助力双杠臂屈伸是助力器械', L.isAssisted(ASSISTED_DIP));
ok('同一个器械上的普通动作(器械推胸)不是', !L.isAssisted(LEVER_CHEST));
ok('弹力带助力不是(不是负重器械,本来也不算 1RM)', !L.isAssisted(BAND_ASSISTED));
ok('绳索助力不是', !L.isAssisted(CABLE_ASSISTED));
ok('自己扶着的(徒手)不是', !L.isAssisted(SELF_ASSISTED));
ok('同伴帮忙的不是', !L.isAssisted(PARTNER));

const assistedIds = EXERCISES.filter((e) => L.isAssisted(e.id)).map((e) => e.id);
const leverIds = EXERCISES.filter((e) => e.equipment === 'leverage machine');
ok('全库命中 8 条(不误伤 81 台器械里的另外 73 条)',
  assistedIds.length === 8 && leverIds.length === 81 && leverIds.filter((e) => !L.isAssisted(e.id)).length === 73,
  `命中 ${assistedIds.length} / 器械 ${leverIds.length}`);
ok('英文名与中文名的判定结果完全一致(中文译名没有多认一条)',
  assistedIds.length === EXERCISES.filter((e) => e.equipment === 'leverage machine' && /assist(ed)?/i.test(e.name)).length);

ok('负重引体向上不是助力器械,而是「附加重量」', !L.isAssisted(WEIGHTED_PULL) && L.isAddedWeight(WEIGHTED_PULL));
ok('全库 36 条附加重量类', EXERCISES.filter((e) => L.isAddedWeight(e.id)).length === 36);
ok('杠铃卧推既不是助力也不是附加重量', !L.isAssisted(BENCH) && !L.isAddedWeight(BENCH));

/* ================= 2. 三种口径怎么念 ================= */
section('显示口径:同一个数字,三种说法');
ok('助力:助力 30kg', L.loadText(ASSISTED_PULL, 30) === '助力 30kg');
ok('助力带小数:助力 12.5kg', L.loadText(ASSISTED_PULL, 12.5) === '助力 12.5kg');
ok('助力为 0 = 已经不用帮了,按自重读', L.loadText(ASSISTED_PULL, 0) === '自重');
ok('附加重量:+20kg', L.loadText(WEIGHTED_PULL, 20) === '+20kg');
ok('普通负重:60kg(不变)', L.loadText(BENCH, 60) === '60kg' && L.loadText(BENCH, null) === '自重');
ok('前缀分开给(页面里数字与单位是两段 Text)',
  L.loadPrefix(ASSISTED_PULL) === '助力 ' && L.loadPrefix(WEIGHTED_PULL) === '+' && L.loadPrefix(BENCH) === '');
ok('名词:重量 / 助力 / 附加重量',
  L.weightNoun(BENCH) === '重量' && L.weightNoun(ASSISTED_PULL) === '助力' && L.weightNoun(WEIGHTED_PULL) === '附加重量');

/* ================= 3. 助力不算 1RM ================= */
section('1RM:助力动作一条都算不出来');
ok('同一组数(30kg × 12)在普通动作上有 1RM', O.e1rmOf(30, 12, false) > 0, `e1rm=${O.e1rmOf(30, 12, false)}`);
ok('在助力动作上是 0 —— 数字越大只是器械帮得越多', L.liftE1rm(ASSISTED_PULL, 12, 30, false) === 0);
ok('换成更轻的助力也不给(不是「重量太轻」的问题)', L.liftE1rm(ASSISTED_PULL, 12, 5, false) === 0);
ok('单侧折算也救不了它(闸门在折算之前)', L.liftE1rm(ASSISTED_PULL, 24, 30, true) === 0);
ok('普通动作走 liftE1rm 结果和 e1rmOf 一致', L.liftE1rm(BENCH, 12, 30, false) === O.e1rmOf(30, 12, false));
ok('附加重量照算(那是「附加重量 1RM」,方向是对的)', L.liftE1rm(WEIGHTED_PULL, 10, 20, false) === O.e1rmOf(20, 10, false));

/* ================= 4. 纪录 / 力量基准 / 力量保持 ================= */
section('纪录、力量基准、力量保持里都不能有助力动作');
const logs = [logOf('2026-10-01', [
  { exerciseId: ASSISTED_PULL, nameZh: '助力引体向上', sets: [set(8, 30), set(8, 30), set(8, 30)] },
  { exerciseId: BENCH, nameZh: '杠铃卧推', sets: [set(8, 60), set(8, 60)] }
])];
const prs = H.personalRecords(logs);
ok('助力动作不进「纪录」列表', !prs.some((p) => p.exerciseId === ASSISTED_PULL));
ok('同一次训练里的普通动作照进(不是把整条日志丢了)', prs.some((p) => p.exerciseId === BENCH && p.bestE1rm > 0));

const pts = H.exerciseHistory(logs, ASSISTED_PULL);
ok('助力动作的曲线留着(次数、容量还能看)', pts.length === 1 && pts[0].topKg === 30 && pts[0].sets === 3);
ok('但曲线上的 1RM 恒为 0(不会画出一条假的上升线)', pts[0].bestE1rm === 0);

const maxes = M.syncMaxes(logs, {});
ok('syncMaxes 不给助力动作建基准', !maxes[ASSISTED_PULL]);
ok('普通动作照建基准', !!maxes[BENCH] && maxes[BENCH].tmKg > 0);

// 存量清理:修复前按助力算出来的基准(含用户手工填的)还躺在本地存储里
M.saveMaxes({
  [ASSISTED_PULL]: { exerciseId: ASSISTED_PULL, nameZh: '助力引体向上', e1rmKg: 33, tmKg: 30, source: 'auto', updatedAt: '' },
  [BENCH]: { exerciseId: BENCH, nameZh: '杠铃卧推', e1rmKg: 70, tmKg: 63, source: 'auto', updatedAt: '' }
});
ok('存量里的助力基准读出来就被滤掉', !M.loadMaxes()[ASSISTED_PULL]);
ok('过滤不误伤别的动作', M.loadMaxes()[BENCH]?.tmKg === 63);
ok('tmOf 也拿不到它(波次开不出 %1RM 的处方)', M.tmOf(M.loadMaxes(), ASSISTED_PULL) === null);
ok('setMax 拒收助力动作', !M.setMax(ASSISTED_PULL, '助力引体向上', 40)[ASSISTED_PULL]);

const rows = ST.strengthRows(logs, '2026-10-10');
ok('「力量保持」里没有助力动作', !rows.some((r) => r.exerciseId === ASSISTED_PULL));
ok('普通动作在「力量保持」里', rows.some((r) => r.exerciseId === BENCH));

/* ================= 5. 计划:助力动作只能按次数渐进 ================= */
section('计划与编辑:助力动作写进去就是次数阶梯');
const built = G.buildItem('vpull', G.findExercise(ASSISTED_PULL), 'muscle', 'beginner');
ok('生成的助力动作是次数阶梯(不是 linear)', built.progression === 'ladder');
ok('助力档位照样写进计划(用户要知道器械调多少)', built.weightKg === 15);
ok('步长留着 —— 降助力要用', built.weightStepKg === 2.5);
const builtW = G.buildItem('vpull', G.findExercise(WEIGHTED_PULL), 'muscle', 'beginner');
ok('负重自重仍是线性加重(方向没变)', builtW.progression === 'linear' && builtW.weightKg === 5);

const pool = G.patternPool('gym', 'beginner');
const pooled = new Set();
for (const pid of Object.keys(pool)) for (const e of pool[pid]) if (L.isAssisted(e.id)) pooled.add(e.id);
const allLadder = [...pooled].every((id) => G.buildItem('vpull', G.findExercise(id), 'muscle', 'beginner').progression === 'ladder');
ok(`候选池里的 ${pooled.size} 个助力动作全部按次数阶梯`, pooled.size === 8 && allLadder);

// 老计划:修复前生成的条目还写着 linear、weightKg 15
const legacy = planItem(ASSISTED_PULL, { progression: 'linear', weightKg: 15 });
const plan = planOf([legacy, planItem(BENCH, { progression: 'linear', weightKg: 60, patternId: 'hpush' })]);
ok('编辑器拒绝把助力动作改成 double/triple(方向是反的)',
  ED.setProgression(plan, 0, 0, 'double').days[0].items[0].progression === 'linear');
ok('但允许写回 ladder(把老计划纠正过来)',
  ED.setProgression(plan, 0, 0, 'ladder').days[0].items[0].progression === 'ladder');
ok('纠正时不会顺手把助力档位清掉',
  ED.setProgression(plan, 0, 0, 'ladder').days[0].items[0].weightKg === 15);
ok('普通动作照旧能选 double', ED.setProgression(plan, 0, 1, 'double').days[0].items[1].progression === 'double');

/* ================= 6. 渐进:永远不加重量,到顶是「降助力」 ================= */
section('渐进:助力器械的「进步」是助力往下走');
const run = (item, sets, prev = {}, planItems) =>
  PROG.applyWorkout(planOf(planItems ?? [item]), 'd1',
    [{ exerciseId: item.exerciseId, sets }], 3600, prev);

// 老计划里还写着 linear:达标后不能出现「加重」
const n1 = run(legacy, [done(12, 15), done(12, 15), done(12, 15)]);
ok('老计划(linear)达标后也不会「加重」', !n1.notes.some((t) => t.includes('加重')) && !/kg → /.test(n1.notes[0] ?? ''), n1.notes[0]);
ok('而是把目标次数往上推', (n1.notes[0] ?? '').includes('目标次数') && n1.next[ASSISTED_PULL].weightKg === 15, n1.notes[0]);

// 次数推满就到顶:下一步是降助力,不是加重量
const atCap = planItem(ASSISTED_PULL, { progression: 'ladder', weightKg: 15, repsMin: 22, repsMax: 25 });
const n2 = run(atCap, [done(25, 15), done(25, 15), done(25, 15)]);
ok('次数到顶后建议「把助力调小」', (n2.notes[0] ?? '').includes('把助力调到 12.5kg'), n2.notes[0]);
ok('而且真的往下调了(15 → 12.5,不是 17.5)', n2.next[ASSISTED_PULL].weightKg === 12.5);

// 连续两次没做到:不能「减载」(减助力 = 加难度)
const below = [done(6, 15), done(6, 15), done(6, 15)];
const f1 = run(legacy, below);
const f2 = run(legacy, below, f1.next);
ok('连续两次未达标不出现「减载」', !f2.notes.some((t) => t.includes('减载')), f2.notes[0]);
ok('而是回退次数目标', (f2.notes[0] ?? '').includes('次数目标回调'));
ok('助力档位一动不动(没做到还给他加难度就荒谬了)', f2.next[ASSISTED_PULL].weightKg === 15);

// 回归:普通负重动作的线性加重不受影响
const bench = planItem(BENCH, { progression: 'linear', weightKg: 60, patternId: 'hpush' });
const n3 = run(bench, [done(8, 60), done(8, 60), done(8, 60)]);
ok('普通动作达标照旧加重(60 → 62.5)', (n3.notes[0] ?? '').includes('60kg → 62.5kg'), n3.notes[0]);

/* ================= 7. 热身:助力不是负重,没有配重热身 ================= */
section('热身:助力动作不做负重热身');
ok('助力动作没有热身组(助力的 40% 不是热身)', L.warmupFor(ASSISTED_PULL, 30, 2.5, 3, false).length === 0);
ok('负重自重的热身照给(那是附加重量)', L.warmupFor(WEIGHTED_PULL, 20, 2.5, 3, false).length > 0);
ok('普通动作的热身与直接调 warmupSets 完全一致',
  JSON.stringify(L.warmupFor(BENCH, 60, 2.5, 3, false)) === JSON.stringify(W.warmupSets(60, 2.5, 3, false)));

/* ================= 8. 分享卡与统计文案 ================= */
section('分享卡:负重自重带 +,助力说清楚是助力');
ok('负重引体:3 组 · +20kg × 8',
  SC.setSummary({ exerciseId: WEIGHTED_PULL, nameZh: '负重引体向上', sets: 3, topWeightKg: 20, topReps: 8 }) === '3 组 · +20kg × 8');
ok('普通动作:3 组 · 60kg × 8(不变)',
  SC.setSummary({ exerciseId: BENCH, nameZh: '杠铃卧推', sets: 3, topWeightKg: 60, topReps: 8 }) === '3 组 · 60kg × 8');
ok('助力器械:3 组 · 助力 30kg × 8(不会读成“我举了 30kg”)',
  SC.setSummary({ exerciseId: ASSISTED_PULL, nameZh: '助力引体向上', sets: 3, topWeightKg: 30, topReps: 8 }) === '3 组 · 助力 30kg × 8');
ok('没有 id 的老调用方还是老文案',
  SC.setSummary({ nameZh: 'x', sets: 3, topWeightKg: 60, topReps: 8 }) === '3 组 · 60kg × 8');

const alog = logOf('2026-10-03', [{ exerciseId: ASSISTED_PULL, nameZh: '助力引体向上', sets: [set(8, 30), set(8, 30)] }]);
ok('助力动作不宣称刷新纪录', SC.prTextOf(alog, H.personalRecords([alog])) === null);
const wlog = logOf('2026-10-04', [{ exerciseId: WEIGHTED_PULL, nameZh: '负重引体向上', sets: [set(8, 20), set(8, 20)] }]);
ok('负重自重的纪录文案带 +', (SC.prTextOf(wlog, H.personalRecords([wlog])) ?? '').includes('+20kg'),
  SC.prTextOf(wlog, H.personalRecords([wlog])));

console.log(`\n${fail ? `FAIL ${fail} 项` : '全部通过'}`);
process.exit(fail ? 1 : 0);
