/**
 * M11 计时组(时长型动作)冒烟测试。
 *
 * 这条链路上只有一个口径:**计时型走 `sec`,`reps` 恒为 0**。
 * 所以这套用例盯五件事:
 *   1. 哪些动作算计时型(静力分类 + 搬运的名字,别把「悬垂举腿」和「俯卧撑转侧平板支撑」卷进来);
 *   2. 秒数怎么念(clampHoldSec / holdText / holdRangeText);
 *   3. 生成器给计时项的**处方**(repsMin/repsMax 归 0,这是故意留的「一眼露馅」);
 *   4. **时长阶梯**(撑满 +5 秒 / 两次没撑到回退 5 秒且不低于 10 秒 / 封顶后换变式或加重);
 *   5. **不串味** —— 这是本套用例存在的理由:计时项留在计划里的 repsMin/repsMax 是 0,
 *      要是它漏进次数规则,「0 >= 0」每次都算达标,目标会从 0 一路加到 4,
 *      用户看见一个「目标 4 次」的平板支撑。它**不报错**,所以必须有用例钉住。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-timed.mjs
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
const T = require(`${E}types.js`);
const TIMED = require(`${E}timed.js`);
const G = require(`${E}generator.js`);
const PROG = require(`${E}progression.js`);
const CUSTOM = require(`${E}custom.js`);
const H = require(`${E}history.js`);
const WT = require(`${E}workout-text.js`);
const SC = require(`${E}share-card.js`);
const ST = require(`${E}settype.js`);
const { EXERCISES } = require('../.smoke/pkg-exercise/data/exercises.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);
/** applyWorkout 的变化汇总是一串人话(notes),按动作名挑出属于这个动作的那条 */
const noteOf = (r, zh) => r.notes.find((n) => n.includes(zh)) ?? '';

/* 用例里用到的真实动作(全部来自 1,324 条动作库) */
const WEIGHTED_PLANK = '2135';   // 负重平板支撑 — 静力,徒手,真只能撑
const SIDE_BRIDGE = '0705';      // 侧桥(变式2)— 静力
const L_SIT = '3419';            // 地面 L 支撑 — 静力
const FARMERS_WALK = '2133';     // 农夫行走 — 挂在「力量」下,按名字收(有配重)
const OVERHEAD_CARRY = '3548';   // 哑铃单臂过头行走 — 同上
const MARCH_SIT = '0624';        // 靠墙坐姿踏步 — 静力分类里的误标(在踏步)
const HANGING_LEG_RAISE = '0472'; // 悬垂举腿 — 名字里有 hang,但是按次数练的
const PUSHUP_SIDE_PLANK = '0664'; // 俯卧撑转侧平板支撑 — 名字像平板,实际在动
const BENCH = '0025';            // 杠铃卧推 — 对照片:次数型一点都不该变
const SIDE_STRETCH = '1358';     // 侧卧地板拉伸 — force=static 的陷阱

/* ================= 判定 ================= */
section('判定:哪些动作按时间练');
ok('负重平板支撑 → 计时', TIMED.isTimed(WEIGHTED_PLANK));
ok('侧桥 → 计时', TIMED.isTimed(SIDE_BRIDGE));
ok('地面 L 支撑 → 计时', TIMED.isTimed(L_SIT));
ok('农夫行走(挂在「力量」下)→ 计时', TIMED.isTimed(FARMERS_WALK));
ok('哑铃单臂过头行走 → 计时', TIMED.isTimed(OVERHEAD_CARRY));
ok('杠铃卧推 → 不是', TIMED.isTimed(BENCH) === false);
// 下面四条是判定的陷阱,全是「名字或分类看着像,实际不是」
ok('悬垂举腿(名字里有 hang)→ **不是**(那是按次数练的)', TIMED.isTimed(HANGING_LEG_RAISE) === false,
  G.findExercise(HANGING_LEG_RAISE).nameZh);
ok('俯卧撑转侧平板支撑(名字像平板,实际在动)→ 不是', TIMED.isTimed(PUSHUP_SIDE_PLANK) === false,
  G.findExercise(PUSHUP_SIDE_PLANK).nameZh);
ok('靠墙坐姿踏步(静力分类但实际在踏步)→ 不是', TIMED.isTimed(MARCH_SIT) === false,
  G.findExercise(MARCH_SIT).nameZh);
ok('侧卧地板拉伸(force=static 的陷阱)→ 不是', TIMED.isTimed(SIDE_STRETCH) === false);
ok('不认识的 id 不炸也不当计时', TIMED.isTimed('__nope__') === false && TIMED.isTimed('') === false);
// 松紧带:判定认出来的总数只能是这几十条,库一改这里就该有人来看一眼
{
  const n = TIMED.timedCount();
  ok('判定一共认了 25 条', n === 25, `${n} 条`);
  ok('静力那 24 条基本都在(去掉误标那条)', n >= 23);
}

/* ================= 秒数怎么念 ================= */
section('秒数怎么念');
ok('45 → 「45 秒」', TIMED.holdText(45) === '45 秒', TIMED.holdText(45));
ok('60 → 「1 分」', TIMED.holdText(60) === '1 分', TIMED.holdText(60));
ok('90 → 「1 分 30 秒」', TIMED.holdText(90) === '1 分 30 秒', TIMED.holdText(90));
ok('120 → 「2 分」', TIMED.holdText(120) === '2 分', TIMED.holdText(120));
ok('0 / 负数 → 「0 秒」(不出现负号)', TIMED.holdText(-5) === '0 秒', TIMED.holdText(-5));
ok('处方区间 「45 秒」上下限相同时不写成 45-45',
  TIMED.holdRangeText(45, 45) === '45 秒' && TIMED.holdRangeText(45, 90) === '45-90 秒');
ok('配重怎么说:没有配重=自重,有=kg', TIMED.holdLoadText(null) === '自重' && TIMED.holdLoadText(20) === '20kg');

section('收口:超过 15 分钟算「忘了按停」,截断而不是丢弃');
ok('撑了 20 分钟 → 记 15 分钟', TIMED.clampHoldSec(20 * 60) === TIMED.HOLD_MAX_SEC, String(TIMED.clampHoldSec(1200)));
ok('正常秒数原样', TIMED.clampHoldSec(62) === 62);
ok('NaN / 负数 / 小数都收干净',
  TIMED.clampHoldSec(NaN) === 0 && TIMED.clampHoldSec(-3) === 0 && TIMED.clampHoldSec(62.6) === 63);

section('达标看的是区间上沿(和次数型比 repsMax 同一个口径)');
ok('有处方 → 取 max', TIMED.holdTargetSec({ min: 20, max: 45 }) === 45);
ok('没处方 → 给默认 30 秒', TIMED.holdTargetSec(undefined) === TIMED.HOLD_DEFAULT_SEC);

section('若干组的计时之和');
ok('只算有 sec 的组', TIMED.holdSecOfSets([{ sec: 30 }, { reps: 8 }, { sec: 45 }]) === 75);
ok('一个都没有 → 0', TIMED.holdSecOfSets([{ reps: 8 }]) === 0);

/* ================= 生成器给的处方 ================= */
section('生成器:计时项的处方是秒,repsMin/repsMax 归 0');
{
  const it = G.buildItem('core', G.findExercise(WEIGHTED_PLANK), 'muscle', 'beginner');
  ok('拿到了 holdSec', !!it.holdSec, JSON.stringify(it.holdSec));
  ok('核心撑得久(区间是 45-90)', it.holdSec && it.holdSec.min === TIMED.HOLD_RANGE.long.min && it.holdSec.max === TIMED.HOLD_RANGE.long.max,
    JSON.stringify(it.holdSec));
  ok('repsMin/repsMax 都归 0', it.repsMin === 0 && it.repsMax === 0, `${it.repsMin}-${it.repsMax}`);
  ok('不复用单侧那一支', it.sided === undefined);

  const carry = G.buildItem('hinge', G.findExercise(FARMERS_WALK), 'muscle', 'beginner');
  ok('搬运类走短的区间(20-45)', carry.holdSec && carry.holdSec.max === TIMED.HOLD_RANGE.short.max, JSON.stringify(carry.holdSec));
  ok('搬运类有配重(重量照旧留着)', carry.weightKg != null, String(carry.weightKg));

  const bench = G.buildItem('hpush', G.findExercise(BENCH), 'muscle', 'beginner');
  ok('对照片:卧推没有 holdSec,次数照旧', !bench.holdSec && bench.repsMin > 0, `${bench.repsMin}-${bench.repsMax}`);
}

section('生成器:单日时长按秒数算,不套「每组 35 秒」那个常数');
{
  const timed = [{ sets: 3, restSec: 60, holdSec: { min: 45, max: 90 } }];
  const reps = [{ sets: 3, restSec: 60, repsMin: 8, repsMax: 12 }];
  const a = G.estMinutes(timed);
  const b = G.estMinutes(reps);
  ok('90 秒的平板撑比 35 秒的卧推算出来的时间长', a > b, `${a} 分 vs ${b} 分`);
}

/* ================= 时长阶梯 ================= */
section('渐进:撑满上限 → 下次 +5 秒');
{
  const item = { exerciseId: WEIGHTED_PLANK, nameZh: '负重平板支撑', patternId: 'core', sets: 3, repsMin: 0, repsMax: 0, holdSec: { min: 45, max: 90 }, restSec: 60, progression: 'ladder', weightKg: null, weightStepKg: 0, alternates: [] };
  const plan = { id: 'p', createdAt: '', goal: 'muscle', level: 'beginner', access: 'body', daysPerWeek: 3, sessionMin: 45, doneCount: 0, lastNote: '', days: [{ key: 'a', title: 'A', focus: '', estMin: 30, items: [item] }] };
  const full = [{ exerciseId: WEIGHTED_PLANK, sets: [90, 90, 90].map((sec) => ({ reps: 0, weightKg: null, done: true, sec })) }];

  const r1 = PROG.applyWorkout(plan, 'a', full, 1800, {});
  const st1 = r1.next[WEIGHTED_PLANK];
  ok('撑到 90 → 目标变成 50-95', st1.holdSec.min === 50 && st1.holdSec.max === 95, JSON.stringify(st1.holdSec));
  ok('目标秒数变了但次数目标一个字节没动', st1.repsMin === 0 && st1.repsMax === 0, `${st1.repsMin}-${st1.repsMax}`);
  ok('提示里说的是秒数,不是次数', /秒|分/.test(noteOf(r1, '负重平板支撑')), noteOf(r1, '负重平板支撑'));

  section('渐进:连续两次没撑到 → 回退 5 秒,且不低于 10 秒');
  const miss = [{ exerciseId: WEIGHTED_PLANK, sets: [{ reps: 0, weightKg: null, done: true, sec: 30 }, { reps: 0, weightKg: null, done: true, sec: 30 }, { reps: 0, weightKg: null, done: true, sec: 30 }] }];
  const prev1 = { [WEIGHTED_PLANK]: { exerciseId: WEIGHTED_PLANK, weightKg: null, repsMin: 0, repsMax: 0, holdSec: { min: 45, max: 90 }, successStreak: 0, failStreak: 1, suggestion: null, updatedAt: '' } };
  const r2 = PROG.applyWorkout(plan, 'a', miss, 1800, prev1);
  ok('回退到 40-85', r2.next[WEIGHTED_PLANK].holdSec.min === 40 && r2.next[WEIGHTED_PLANK].holdSec.max === 85,
    JSON.stringify(r2.next[WEIGHTED_PLANK].holdSec));

  // 再失败一次就触发回退;这一组的秒数(30)离目标(45-90)还差得远
  const prevLow = { [WEIGHTED_PLANK]: { exerciseId: WEIGHTED_PLANK, weightKg: null, repsMin: 0, repsMax: 0, holdSec: { min: 10, max: 20 }, successStreak: 0, failStreak: 1, suggestion: null, updatedAt: '' } };
  const r3 = PROG.applyWorkout(plan, 'a', [{ exerciseId: WEIGHTED_PLANK, sets: [8, 8, 8].map((sec) => ({ reps: 0, weightKg: null, done: true, sec })) }], 1800, prevLow);
  ok('已经在下限了就不再往下退(10 秒是地板)', r3.next[WEIGHTED_PLANK].holdSec.min === 10,
    JSON.stringify(r3.next[WEIGHTED_PLANK].holdSec));

  section('渐进:撑过了下限但没到上限 → 目标不动(不是每次都涨)');
  const prevMid = { [WEIGHTED_PLANK]: { exerciseId: WEIGHTED_PLANK, weightKg: null, repsMin: 0, repsMax: 0, holdSec: { min: 45, max: 90 }, successStreak: 1, failStreak: 0, suggestion: null, updatedAt: '' } };
  const r3b = PROG.applyWorkout(plan, 'a', [{ exerciseId: WEIGHTED_PLANK, sets: [60, 60, 60].map((sec) => ({ reps: 0, weightKg: null, done: true, sec })) }], 1800, prevMid);
  ok('撑到 60(≥45 但 <90)→ 目标还是 45-90', r3b.next[WEIGHTED_PLANK].holdSec.min === 45 && r3b.next[WEIGHTED_PLANK].holdSec.max === 90,
    JSON.stringify(r3b.next[WEIGHTED_PLANK].holdSec));
  ok('但连续达标次数记上了(为下一次进阶铺路)', r3b.next[WEIGHTED_PLANK].successStreak === 2,
    String(r3b.next[WEIGHTED_PLANK].successStreak));

  section('渐进:封顶 120 秒之后不再加时间');
  const capped = { [WEIGHTED_PLANK]: { exerciseId: WEIGHTED_PLANK, weightKg: null, repsMin: 0, repsMax: 0, holdSec: { min: 115, max: 120 }, successStreak: 3, failStreak: 0, suggestion: null, updatedAt: '' } };
  const r4 = PROG.applyWorkout(plan, 'a', [{ exerciseId: WEIGHTED_PLANK, sets: [120, 120, 120].map((sec) => ({ reps: 0, weightKg: null, done: true, sec })) }], 1800, capped);
  ok('封顶后 max 不超过 120', r4.next[WEIGHTED_PLANK].holdSec.max <= TIMED.HOLD_PROGRESS_CAP_SEC,
    JSON.stringify(r4.next[WEIGHTED_PLANK].holdSec));
  ok('而是给了一条「下一步换更难」的话', !!noteOf(r4, '负重平板支撑'), noteOf(r4, '负重平板支撑') || '(无)');

  section('渐进:有配重的搬运类,撑满之后是**加重**而不是换变式');
  const carryItem = { exerciseId: FARMERS_WALK, nameZh: '农夫行走', patternId: 'hinge', sets: 3, repsMin: 0, repsMax: 0, holdSec: { min: 115, max: 120 }, restSec: 60, progression: 'ladder', weightKg: 20, weightStepKg: 2.5, alternates: [] };
  const carryPlan = { ...plan, days: [{ key: 'a', title: 'A', focus: '', estMin: 30, items: [carryItem] }] };
  const r5 = PROG.applyWorkout(carryPlan, 'a', [{ exerciseId: FARMERS_WALK, sets: [120, 120, 120].map((sec) => ({ reps: 0, weightKg: 20, done: true, sec })) }], 1800, {});
  ok('重量加上去了(20 → 22.5)', r5.next[FARMERS_WALK].weightKg === 22.5, String(r5.next[FARMERS_WALK].weightKg));
  ok('注意:时长目标没跟着涨(封顶了)', r5.next[FARMERS_WALK].holdSec.max === 120, JSON.stringify(r5.next[FARMERS_WALK].holdSec));
}

/* ================= 不串味(本套用例存在的理由) ================= */
section('不串味:计时项绝不走次数规则');
{
  const item = { exerciseId: WEIGHTED_PLANK, nameZh: '负重平板支撑', patternId: 'core', sets: 3, repsMin: 0, repsMax: 0, holdSec: { min: 45, max: 90 }, restSec: 60, progression: 'ladder', weightKg: null, weightStepKg: 0, alternates: [] };
  const plan = { id: 'p', createdAt: '', goal: 'muscle', level: 'beginner', access: 'body', daysPerWeek: 3, sessionMin: 45, doneCount: 0, lastNote: '', days: [{ key: 'a', title: 'A', focus: '', estMin: 30, items: [item] }] };
  // 连做 6 次,每次都撑满(15 分钟那个上限)—— 次数规则下 repsMax 会一路加,
  // 时长规则下它必须一直是 0,而涨的是秒数
  let prev = {};
  let lastMax = 0;
  for (let i = 0; i < 6; i++) {
    const r = PROG.applyWorkout(plan, 'a', [{ exerciseId: WEIGHTED_PLANK, sets: [TIMED.HOLD_MAX_SEC, TIMED.HOLD_MAX_SEC, TIMED.HOLD_MAX_SEC].map((sec) => ({ reps: 0, weightKg: null, done: true, sec })) }], 1800, prev);
    prev = r.next;
    lastMax = prev[WEIGHTED_PLANK].repsMax;
  }
  ok('连做 6 次之后 repsMax 仍然是 0(没有变成「目标 4 次」)', lastMax === 0, `repsMax=${lastMax}`);
  ok('而秒数目标确实一路涨到封顶', prev[WEIGHTED_PLANK].holdSec.max === TIMED.HOLD_PROGRESS_CAP_SEC,
    JSON.stringify(prev[WEIGHTED_PLANK].holdSec));
}
{
  // 旧日志没有 sec:当「没撑到」处理 —— 安全的方向是目标不动,而不是凭一个不存在的秒数往上涨
  const item = { exerciseId: WEIGHTED_PLANK, nameZh: '负重平板支撑', patternId: 'core', sets: 3, repsMin: 0, repsMax: 0, holdSec: { min: 45, max: 90 }, restSec: 60, progression: 'ladder', weightKg: null, weightStepKg: 0, alternates: [] };
  const plan = { id: 'p', createdAt: '', goal: 'muscle', level: 'beginner', access: 'body', daysPerWeek: 3, sessionMin: 45, doneCount: 0, lastNote: '', days: [{ key: 'a', title: 'A', focus: '', estMin: 30, items: [item] }] };
  const legacy = [{ exerciseId: WEIGHTED_PLANK, sets: [0, 0, 0].map((reps) => ({ reps, weightKg: null, done: true })) }];
  const r = PROG.applyWorkout(plan, 'a', legacy, 1800, {});
  ok('老日志(没有 sec)不会把目标推上去', r.next[WEIGHTED_PLANK].holdSec.max <= 90, JSON.stringify(r.next[WEIGHTED_PLANK].holdSec));
}

section('不串味:计时组进得了日志,但容量贡献是 0');
{
  const item = { exerciseId: WEIGHTED_PLANK, nameZh: '负重平板支撑', patternId: 'core', sets: 2, repsMin: 0, repsMax: 0, holdSec: { min: 45, max: 90 }, restSec: 60, progression: 'ladder', weightKg: null, weightStepKg: 0, alternates: [] };
  const bench = { exerciseId: BENCH, nameZh: '杠铃卧推', patternId: 'hpush', sets: 2, repsMin: 8, repsMax: 12, restSec: 90, progression: 'linear', weightKg: 60, weightStepKg: 2.5, alternates: [] };
  const plan = { id: 'p', createdAt: '', goal: 'muscle', level: 'beginner', access: 'gym', daysPerWeek: 3, sessionMin: 45, doneCount: 0, lastNote: '', days: [{ key: 'a', title: 'A', focus: '', estMin: 30, items: [item, bench] }] };
  const r = PROG.applyWorkout(plan, 'a', [
    { exerciseId: WEIGHTED_PLANK, sets: [{ reps: 0, weightKg: null, done: true, sec: 60 }, { reps: 0, weightKg: null, done: true, sec: 55 }] },
    { exerciseId: BENCH, sets: [{ reps: 10, weightKg: 60, done: true }, { reps: 10, weightKg: 60, done: true }] }
  ], 1800, {});
  const log = r.log;
  const plankEntry = log.entries.find((e) => e.exerciseId === WEIGHTED_PLANK);
  ok('计时组被记进日志了(不是「没做」)', plankEntry && plankEntry.sets.length === 2, String(plankEntry?.sets.length));
  ok('记下来的是秒数,reps 是 0', plankEntry.sets[0].sec === 60 && plankEntry.sets[0].reps === 0,
    JSON.stringify(plankEntry.sets[0]));
  ok('总次数只数了卧推的 20(秒数没被当成次数)', log.totalReps === 20, String(log.totalReps));
  ok('容量只算了卧推的 1200(秒数没被乘进容量)', log.totalVolumeKg === 1200, String(log.totalVolumeKg));
  ok('总组数把计时组也算上了(4 组,不是 2 组)', log.totalSets === 4, String(log.totalSets));
}

/* ================= 文字版 ================= */
section('复制成文字:计时组写得出来,且不写成「×次」');
{
  const log = {
    id: 'wo-1', planId: 'p', dayKey: 'a', dayTitle: '核心日', date: '2026-10-01',
    durationSec: 1800, totalSets: 3, totalReps: 0, totalVolumeKg: 0, avgRir: null,
    entries: [{ exerciseId: WEIGHTED_PLANK, nameZh: '负重平板支撑', sets: [{ reps: 0, weightKg: null, rir: null, sec: 60 }, { reps: 0, weightKg: null, rir: null, sec: 55 }] }]
  };
  const txt = WT.workoutText(log);
  ok('动作没被整块吞掉', txt.includes('负重平板支撑'), txt.replace(/\n/g, ' / '));
  // 60 秒按「1 分」念(holdText 的口径),55 秒按秒念
  ok('组写的是时长(60 秒念成 1 分,55 秒念成 55 秒)', /1 分/.test(txt) && /55 秒/.test(txt), txt.replace(/\n/g, ' / '));
  ok('顶部那行有「保持 1 分 55 秒」(不然核心日只剩一个「0 次」)', /保持 1 分 55 秒/.test(txt), txt.replace(/\n/g, ' / '));
  ok('不写成「× 0」', !/×\s*0/.test(txt), txt.replace(/\n/g, ' / '));
}
{
  // 老日志(只有 reps)一个字都不该变
  const log = {
    id: 'wo-2', planId: 'p', dayKey: 'a', dayTitle: '推日', date: '2026-10-01',
    durationSec: 1800, totalSets: 2, totalReps: 20, totalVolumeKg: 1200, avgRir: null,
    entries: [{ exerciseId: BENCH, nameZh: '杠铃卧推', sets: [{ reps: 10, weightKg: 60, rir: null }, { reps: 10, weightKg: 60, rir: null }] }]
  };
  const txt = WT.workoutText(log);
  ok('次数型照旧写「60kg × 10」', txt.includes('60kg × 10'), txt.replace(/\n/g, ' / '));
}

/* ================= 分享卡与统计 ================= */
section('分享卡:计时动作写得出「保持多久」,而且进得了纪录');
{
  const log = {
    id: 'wo-3', planId: 'p', dayKey: 'a', dayTitle: '核心日', date: '2026-10-01',
    durationSec: 1800, totalSets: 2, totalReps: 0, totalVolumeKg: 0, avgRir: null,
    entries: [{ exerciseId: WEIGHTED_PLANK, nameZh: '负重平板支撑', sets: [{ reps: 0, weightKg: null, rir: null, sec: 90 }, { reps: 0, weightKg: null, rir: null, sec: 60 }] }]
  };
  const prs = H.personalRecords([log]);
  const pr = prs.find((p) => p.exerciseId === WEIGHTED_PLANK);
  ok('计时动作进得了个人纪录(以前三个维度全是 0,一个都进不来)', !!pr);
  ok('纪录里的保持时长是**最长那组**(90 秒,不是最后一组 60 秒)', pr && pr.bestHoldSec === 90, String(pr?.bestHoldSec));

  const card = SC.cardDataOf(log, prs);
  ok('卡上有这个动作(不是空的)', card.entries.length === 1);
  ok('卡上写「2 组 · 自重 1 分 30 秒」', SC.setSummary(card.entries[0]) === '2 组 · 自重 1 分 30 秒', SC.setSummary(card.entries[0]));
  ok('纪录那行说的是「保持」,不是「× 0」', /保持 1 分 30 秒/.test(card.prText ?? ''), card.prText ?? '(无)');
}

section('统计:最长保持与保持总时长');
{
  const mk = (date, secs) => ({
    id: `wo-${date}`, planId: 'p', dayKey: 'a', dayTitle: '核心日', date,
    durationSec: 1200, totalSets: secs.length, totalReps: 0, totalVolumeKg: 0, avgRir: null,
    entries: [{ exerciseId: WEIGHTED_PLANK, nameZh: '负重平板支撑', sets: secs.map((sec) => ({ reps: 0, weightKg: null, rir: null, sec })) }]
  });
  const logs = [mk('2026-09-30', [60, 60]), mk('2026-10-02', [75, 70])];
  const pts = H.exerciseHistory(logs, WEIGHTED_PLANK);
  ok('曲线各天都记到了', pts.length === 2, String(pts.length));
  ok('曲线上的保持时长是当天最长那组(75,不是 70)', pts[1].holdSec === 75, String(pts[1].holdSec));
  ok('次数那一维是 0(所以页面不会画一条贴着横轴的次数线)', pts[1].reps === 0 && pts[1].topKg === 0);

  ok('「这次一共撑了多久」也留下了(第一天 120 / 第二天 145)',
    pts[0].holdTotalSec === 120 && pts[1].holdTotalSec === 145,
    `${pts[0].holdTotalSec} / ${pts[1].holdTotalSec}`);

  const sum = H.summaryOf(logs);
  ok('区间汇总里有一共撑了多久(265 秒)', sum.holdSec === 265, String(sum.holdSec));
  ok('总次数照旧是 0(秒数没混进来)', sum.reps === 0, String(sum.reps));
  ok('总组数照旧数到 4 组', sum.sets === 4, String(sum.sets));
}

section('掉力:计时型看秒数在不在掉,不看次数');
{
  const sets = (secs) => secs.map((sec) => ({ reps: 0, weightKg: null, rir: null, sec }));

  const a = H.holdDrop(sets([60, 58, 55]));
  ok('末组掉了 8%', a.bars.length === 3 && a.lastDropPct === 8, String(a.lastDropPct));
  ok('8% 说的是「这组时长能连撑下来」', /10% 以内/.test(a.verdict), a.verdict);

  const up = H.holdDrop(sets([40, 45]));
  ok('末组反而撑得更久 → 说前面留了力气', up.lastDropPct < 0 && /留了力气/.test(up.verdict), up.verdict);

  const heavy = H.holdDrop(sets([60, 40]));
  ok('掉 33% → 明说这个时长太长了', heavy.lastDropPct === 33 && /七成/.test(heavy.verdict), heavy.verdict);

  const mid = H.holdDrop(sets([60, 48]));
  ok('掉 20% → 让多歇 30 秒或降一档', mid.lastDropPct === 20 && /休息/.test(mid.verdict), mid.verdict);

  const zero = H.holdDrop(sets([60, 0]));
  ok('有一组没记时长就明说不算,不硬凑一个结论', /没记时长/.test(zero.verdict), zero.verdict);

  ok('只有一组就说看不出', /只有一组/.test(H.holdDrop(sets([60])).verdict));

  // 反证:同一批组交给次数型的 dropOff 会说什么 —— 这就是两者必须分开写的理由
  const wrong = H.dropOff(sets([60, 40]));
  ok('dropOff 对全身重计时组是空转(挑不出一组来比)', wrong.sets.length === 0, String(wrong.sets.length));
  ok('它还建议「看次数」—— 而计时组根本没有次数',
    /看次数/.test(H.dropHint(sets([60, 40])) ?? ''), H.dropHint(sets([60, 40])) ?? '(null)');
}

/* ================= 组型不给出计时组凭空造次数 =================
 * 这一节钉的是训练页 `rowsOf` 里那一句 `reps: holdSec ? 0 : s.reps` 的必要性:
 * `expandSets` 的金字塔/力竭那些分支是按次数算的,喂给它一个「0 次的计时项」,
 * 它会自己补出一个非 0 的次数来(金字塔 `Math.max(1, …)`、力竭 `min(30, repsMax + 4)`)。
 * 界面上看不出来(计时行显示的是秒),但它会顺着日志写进统计 —— 所以那一句归零不能删。
 */
section('组型不会给计时组凭空造出次数');
{
  const base = { sets: 3, repsMin: 0, repsMax: 0, weightKg: 20 };
  const plain = ST.expandSets(base, 'normal', 2.5);
  ok('常规组型铺出来就是 0 次', plain.every((s) => s.reps === 0), plain.map((s) => s.reps).join(','));

  const bo = ST.expandSets(base, 'backoff', 2.5);
  ok('减重组自己造了一个次数(末组 min(30, repsMax + 4) —— 所以训练页必须归零)',
    bo.some((s) => s.reps > 0), bo.map((s) => s.reps).join(','));
  const pyr = ST.expandSets(base, 'pyramid', 2.5);
  ok('金字塔也一样(那一支取 Math.max(1, …))', pyr.some((s) => s.reps > 0), pyr.map((s) => s.reps).join(','));
  ok('力竭那一支反过来不会(它取的是 Math.min(30, repsMax),0 还是 0)',
    ST.expandSets(base, 'failure', 2.5).every((s) => s.reps === 0));

  // 归零之后,那一组进日志时对「总次数」和「容量」的贡献是 0 —— 计时项的口径
  const zeroed = bo.map((s) => ({ reps: 0, weightKg: s.weightKg, rir: null, sec: 45 }));
  const log = {
    id: 'wo-st', planId: 'p', dayKey: 'a', dayTitle: '核心日', date: '2026-10-01',
    durationSec: 600, totalSets: zeroed.length, totalReps: 0, totalVolumeKg: 0, avgRir: null,
    entries: [{ exerciseId: WEIGHTED_PLANK, nameZh: '负重平板支撑', sets: zeroed }]
  };
  ok('归零后的计时组:总次数 0、容量 0、但撑住的时长在',
    H.summaryOf([log]).reps === 0 && H.summaryOf([log]).volumeKg === 0 && H.summaryOf([log]).holdSec === 135,
    `${H.summaryOf([log]).reps} 次 / ${H.summaryOf([log]).volumeKg} kg / ${H.summaryOf([log]).holdSec} 秒`);
}

/* ================= 自定义动作的计时开关 ================= */
section('自定义动作:先问它自己那个开关');
{
  const [d] = CUSTOM.sanitizeCustom([
    { id: 'c-timed1', name: '我的靠墙静蹲', bodyPart: 'upper legs', equipment: 'body weight', timed: true }
  ]);
  ok('timed 存下来了', d && d.timed === true);
  const [d2] = CUSTOM.sanitizeCustom([
    { id: 'c-timed2', name: '随便一个', bodyPart: 'chest', equipment: 'body weight' }
  ]);
  ok('没勾就是次数型', d2 && d2.timed === false);
  // 用户自建的「靠墙静蹲」不在动作库里,判定只能问它自己那份
  ok('自定义动作的判定不看动作库(它本来就不在库里)', d && !EXERCISES.some((e) => e.id === 'c-timed1'));
}

/* ================= 禁词自查(微信审核红线) ================= */
section('面向用户的文案里不出现那几个词');
{
  const words = ['AI', '智能', '大模型', '智谱'];
  const texts = [
    TIMED.holdText(90), TIMED.holdRangeText(45, 90), TIMED.holdLoadText(20),
    WT.workoutText({
      id: 'x', planId: 'p', dayKey: 'a', dayTitle: '核心日', date: '2026-10-01',
      durationSec: 600, totalSets: 1, totalReps: 0, totalVolumeKg: 0, avgRir: null,
      entries: [{ exerciseId: L_SIT, nameZh: '地面L支撑', sets: [{ reps: 0, weightKg: null, rir: null, sec: 30 }] }]
    })
  ].join('|');
  ok('没有禁词', !words.some((w) => texts.includes(w)), texts);
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
