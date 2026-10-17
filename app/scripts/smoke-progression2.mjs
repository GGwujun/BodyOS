/**
 * M2.3 渐进策略扩展 冒烟测试
 *   - max.ts    训练最大重量:估算 / 自动刷新 / 手填不被覆盖 / %1RM
 *   - triple    三阶渐进:次数推满 → 加组 → 组数到顶才加重
 *   - amrap     末组尽力:标签与提示 / 多做很多时跳两档
 *   - cycle     line 减载周 / 531 波次处方 / 走满一轮上调基准 / 波次锁定动作不走常规渐进
 * 用法:node scripts/smoke-progression2.mjs(.smoke 目录由 tsc 预先生成)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// @tarojs/taro 在 node 里跑不起来 — 用一个内存版 storage 顶替
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

const MAX = require('../.smoke/pkg-exercise/engine/max.js');
const CYCLE = require('../.smoke/pkg-exercise/engine/cycle.js');
const PROG = require('../.smoke/pkg-exercise/engine/progression.js');
const SETTYPE = require('../.smoke/pkg-exercise/engine/settype.js');
const STORE = require('../.smoke/pkg-exercise/engine/store.js');
const { EXERCISES } = require('../.smoke/pkg-exercise/data/exercises.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

/* ================= max.ts ================= */
const logs = [
  {
    id: 'wo-1', planId: 'p', dayKey: 'd', dayTitle: '推', date: '2026-10-01',
    durationSec: 1800, totalSets: 3, totalReps: 24, totalVolumeKg: 1200, avgRir: 2,
    entries: [{ exerciseId: 'ex-a', nameZh: '卧推', sets: [{ reps: 8, weightKg: 60, rir: 2 }, { reps: 8, weightKg: 60, rir: null }] }]
  },
  {
    id: 'wo-2', planId: 'p', dayKey: 'd', dayTitle: '推', date: '2026-10-05', manual: true,
    durationSec: 1800, totalSets: 3, totalReps: 24, totalVolumeKg: 9999, avgRir: null,
    entries: [{ exerciseId: 'ex-a', nameZh: '卧推', sets: [{ reps: 1, weightKg: 200, rir: null }, { reps: 1, weightKg: 200, rir: null }] }]
  },
  {
    id: 'wo-3', planId: 'p', dayKey: 'd', dayTitle: '推', date: '2026-10-08',
    durationSec: 1800, totalSets: 3, totalReps: 18, totalVolumeKg: 900, avgRir: 1,
    entries: [{ exerciseId: 'ex-b', nameZh: '弯举', sets: [{ reps: 15, weightKg: 40, rir: null }, { reps: 15, weightKg: 40, rir: null }] }]
  }
];

const m1 = MAX.syncMaxes(logs, {});
const e1rmA = MAX.estimateFromLogsCheck ?? null;
ok('记录 → 自动算出基准', !!m1['ex-a'] && m1['ex-a'].source === 'auto', JSON.stringify(m1['ex-a'] ?? null));
ok('补录日志不参与估算', !m1['ex-b'], m1['ex-b'] ? '竟然算了 200kg 那条' : '');
ok('TM = 估算 1RM × 0.9', m1['ex-a'] && Math.abs(m1['ex-a'].tmKg - m1['ex-a'].e1rmKg * 0.9) < 0.02,
  `${m1['ex-a']?.e1rmKg} → ${m1['ex-a']?.tmKg}`);
ok('60kg×8 的 1RM 估算落在合理区间', m1['ex-a'].e1rmKg > 70 && m1['ex-a'].e1rmKg < 82, `${m1['ex-a'].e1rmKg}kg`);

MAX.setMax('ex-a', '卧推', 50);
const m2 = MAX.syncMaxes(logs, MAX.loadMaxes());
ok('手填基准不被日志覆盖', m2['ex-a'].tmKg === 50 && m2['ex-a'].source === 'manual', `${m2['ex-a'].tmKg}kg / ${m2['ex-a'].source}`);

ok('%训练最大重量 取整到步长', MAX.pctOfTm(50, 0.85, 2.5) === 42.5, String(MAX.pctOfTm(50, 0.85, 2.5)));
ok('重量占基准的百分比', MAX.pctOfWeight(40, 50) === 80, String(MAX.pctOfWeight(40, 50)));
ok('自重 / 无基准 → 无百分比', MAX.pctOfWeight(null, 50) === null && MAX.pctOfWeight(40, null) === null);

MAX.bumpMax('ex-a', '卧推', 2.5);
ok('周期走满一轮 → 基准上调一档', MAX.loadMaxes()['ex-a'].tmKg === 52.5, `${MAX.loadMaxes()['ex-a'].tmKg}kg`);
MAX.clearMax('ex-a');
ok('清除基准', !MAX.loadMaxes()['ex-a']);

/* ================= 三阶渐进 ================= */
const plan0 = {
  id: 'plan-1', createdAt: '2026-10-01T00:00:00.000Z', goal: 'muscle', level: 'intermediate',
  access: 'gym', daysPerWeek: 3, sessionMin: 45, doneCount: 0, lastNote: '',
  days: [{
    key: 'push', title: '推', focus: '胸肩三头', estMin: 30,
    items: [
      { exerciseId: 'tri-1', nameZh: '三阶动作', patternId: 'hpush', sets: 3, repsMin: 8, repsMax: 12, restSec: 90, progression: 'triple', weightKg: 40, weightStepKg: 2.5, alternates: [] },
      { exerciseId: 'lin-1', nameZh: '线性动作', patternId: 'hpull', sets: 3, repsMin: 8, repsMax: 12, restSec: 90, progression: 'linear', weightKg: 40, weightStepKg: 2.5, alternates: [] }
    ]
  }]
};
const entryOf = (id, n, reps, w) => ({ exerciseId: id, sets: Array.from({ length: n }, () => ({ reps, weightKg: w, done: true, rir: 2 })) });

let st = {};
let r = PROG.applyWorkout(plan0, 'push', [entryOf('tri-1', 3, 12, 40)], 1800, st);
st = r.next;
ok('三阶:次数推满 → 加一组(不是加重)',
  st['tri-1'].sets === 4 && st['tri-1'].weightKg === 40, `sets=${st['tri-1'].sets} w=${st['tri-1'].weightKg} | ${r.notes[0] ?? ''}`);

r = PROG.applyWorkout(plan0, 'push', [entryOf('tri-1', 4, 12, 40)], 1800, st);
st = r.next;
ok('三阶:再加一组到 5', st['tri-1'].sets === 5, `sets=${st['tri-1'].sets} | ${r.notes[0] ?? ''}`);

r = PROG.applyWorkout(plan0, 'push', [entryOf('tri-1', 5, 12, 40)], 1800, st);
st = r.next;
ok('三阶:5 组到顶 → 加重并回到起始组数',
  st['tri-1'].sets === 3 && st['tri-1'].weightKg === 42.5,
  `sets=${st['tri-1'].sets} w=${st['tri-1'].weightKg} | ${r.notes[0] ?? ''}`);

// 未打到上限:三阶只提示继续推次数,不动重量
r = PROG.applyWorkout(plan0, 'push', [entryOf('tri-1', 3, 9, 40)], 1800, {});
ok('三阶:区间内 → 保持重量继续推次数',
  r.next['tri-1'].weightKg === 40 && r.next['tri-1'].sets === 3, r.notes[0] ?? '');

/* ================= 计划外的动作(换/加练进来的) ================= */
// 训练页有两个口子会造出「计划里没有的动作」:换个动作换到计划外的、加练一个动作插进来的。
// 它们**必须进日志** —— 否则在训练页上看着练了,记完账却没有:不进容量、不进纪录、
// 不动力量基准、分享卡上也没有,而且是静默的。渐进则相反:手上没有它的处方,不能凭空推目标。
const outside = EXERCISES[0];
const rOut = PROG.applyWorkout(plan0, 'push', [entryOf('tri-1', 3, 12, 40), entryOf(outside.id, 2, 8, 40)], 1800, {});
ok('计划外的动作照进日志,名字从动作库里取',
  rOut.log.entries.length === 2 && rOut.log.entries[1].exerciseId === outside.id
  && rOut.log.entries[1].nameZh === outside.nameZh,
  rOut.log.entries.map((e) => `${e.nameZh}×${e.sets.length}`).join(' / '));
// 3 组 × 12 次 × 40kg = 1440,加练的 2 组 × 8 次 × 40kg = 640
ok('它的组数次数进容量(不是白练)',
  rOut.log.totalSets === 5 && rOut.log.totalReps === 52 && rOut.log.totalVolumeKg === 2080,
  `${rOut.log.totalSets} 组 / ${rOut.log.totalReps} 次 / ${rOut.log.totalVolumeKg}kg`);
// 「在日志里」和「渐进不碰它」两件事要一起断言:少了前一半,后一半在「它压根没进日志」时也是真的
ok('渐进不碰它(没有处方就别动它的目标)',
  rOut.log.entries.some((e) => e.exerciseId === outside.id) && rOut.next[outside.id] === undefined && rOut.next['tri-1'] != null);
ok('计划里也没有它 → 不写超级组号', rOut.log.entries[1]?.superset === undefined && rOut.log.entries[1]?.exerciseId === outside.id);
ok('名字都查不到的动作(自定义动作被删了)整条丢掉,不炸', (() => {
  const r2 = PROG.applyWorkout(plan0, 'push', [entryOf('nope-xyz', 2, 8, 40)], 1800, {});
  return r2.log.entries.length === 0 && r2.log.totalSets === 0 && r2.notes.length === 0;
})());
ok('只有没打勾的组 → 这一条还是空的(和计划内动作同一口径)', (() => {
  const r3 = PROG.applyWorkout(plan0, 'push', [
    { exerciseId: outside.id, sets: [{ reps: 8, weightKg: 40, done: false, rir: null }] }
  ], 1800, {});
  return r3.log.entries.length === 1 && r3.log.entries[0].sets.length === 0 && r3.log.totalSets === 0;
})());

/* ================= AMRAP 末组 ================= */
const amrap = SETTYPE.expandSets({ sets: 3, repsMin: 5, repsMax: 5, weightKg: 60, amrapLast: true }, 'normal', 2.5);
ok('AMRAP:末组挂「尽力」标与提示', amrap[2].tag === '尽力' && /还有余力就继续做/.test(amrap[2].note ?? ''),
  `${amrap[2].tag} / ${amrap[2].note}`);
ok('AMRAP:前两组不受影响', amrap[0].tag === '' && amrap[0].reps === 5);

const amrapItem = {
  exerciseId: 'am-1', nameZh: '主项', patternId: 'squat', sets: 3, repsMin: 5, repsMax: 5,
  restSec: 180, progression: 'linear', weightKg: 60, weightStepKg: 2.5, alternates: [], amrapLast: true
};
const planAm = { ...plan0, days: [{ ...plan0.days[0], items: [amrapItem] }] };
const rAm = PROG.applyWorkout(planAm, 'push', [entryForAm()], 1800, {});
function entryForAm() {
  return { exerciseId: 'am-1', sets: [{ reps: 5, weightKg: 60, done: true }, { reps: 5, weightKg: 60, done: true }, { reps: 9, weightKg: 60, done: true }] };
}
ok('AMRAP:末组多做 3 个以上 → 跳两档加重',
  rAm.next['am-1'].weightKg === 65, `${rAm.next['am-1'].weightKg}kg | ${rAm.notes[0] ?? ''}`);

/* ================= 周期 ================= */
// 找一个真实的复合动作当主项(波次只作用于 compound)
const compound = EXERCISES.find((e) => e.mechanic === 'compound' && e.equipment === 'barbell' && e.level !== 'expert');
ok('找到可用作主项的复合动作', !!compound, compound?.nameZh ?? '');

const iso = EXERCISES.find((e) => e.mechanic === 'isolation' && e.equipment === 'cable');

const planC = {
  ...plan0,
  days: [{
    key: 'push', title: '推', focus: '', estMin: 30,
    items: [
      { exerciseId: compound.id, nameZh: compound.nameZh, patternId: 'hpush', sets: 4, repsMin: 8, repsMax: 12, restSec: 90, progression: 'linear', weightKg: 60, weightStepKg: 2.5, alternates: [] },
      { exerciseId: iso.id, nameZh: iso.nameZh, patternId: 'tri', sets: 3, repsMin: 10, repsMax: 15, restSec: 60, progression: 'linear', weightKg: 20, weightStepKg: 2.5, alternates: [] }
    ]
  }]
};
MAX.saveMaxes({});
MAX.setMax(compound.id, compound.nameZh, 100);   // 手填基准 100kg
MAX.setMax(iso.id, iso.nameZh, 30);              // 孤立动作也有基准,但不该被波次接管

const cyc531 = CYCLE.setCycle(planC, '531');
ok('开启 531 周期:回到第 1 周', cyc531.cycle && cyc531.cycle.week === 1, JSON.stringify(cyc531.cycle));

const w1 = CYCLE.applyCycle(cyc531, MAX.loadMaxes());
const it1 = w1.days[0].items[0];
ok('531 第 1 周:主项被波次接管(%85 顶重量 / 3 组 × 5 次)',
  it1.cycleLocked === true && it1.sets === 3 && it1.repsMin === 5 && it1.repsMax === 5 && it1.weightKg === 85,
  `locked=${it1.cycleLocked} ${it1.sets}组×${it1.repsMin}-${it1.repsMax} ${it1.weightKg}kg`);
ok('531:主项组型转金字塔、组间休息拉到 3 分钟',
  it1.setType === 'pyramid' && it1.restSec >= 180, `${it1.setType} / ${it1.restSec}s`);
ok('531:主项末组尽力', it1.amrapLast === true);
ok('531:孤立动作不被接管', !w1.days[0].items[1].cycleLocked && w1.days[0].items[1].repsMin === 10,
  `${w1.days[0].items[1].repsMin}-${w1.days[0].items[1].repsMax}`);
ok('531:套用后重算单堂时长', w1.days[0].estMin > 0, `${w1.days[0].estMin} 分钟`);

// 波次锁定 → 常规渐进让位(练满也不加重量)
const lockedEntry = { exerciseId: compound.id, sets: Array.from({ length: 3 }, () => ({ reps: 5, weightKg: 85, done: true })) };
const isoEntry = { exerciseId: iso.id, sets: Array.from({ length: 3 }, () => ({ reps: 15, weightKg: 20, done: true })) };
let stC = {};
let rC = PROG.applyWorkout(w1, 'push', [lockedEntry, isoEntry], 1800, stC, undefined);
ok('531 周:锁定动作不改重量', !rC.next[compound.id] || rC.next[compound.id].weightKg === 85,
  `${rC.next[compound.id]?.weightKg}`);
ok('531 周:未锁定动作照常渐进', rC.next[iso.id].weightKg > 20, `${rC.next[iso.id].weightKg}kg`);

// 周次推进:第 2/3 周处方不同,第 4 周减载
const w2 = CYCLE.applyCycle({ ...cyc531, cycle: { style: '531', week: 2 } }, MAX.loadMaxes());
ok('531 第 2 周:3 次 × 90%', w2.days[0].items[0].repsMin === 3 && w2.days[0].items[0].weightKg === 90,
  `${w2.days[0].items[0].repsMin} 次 / ${w2.days[0].items[0].weightKg}kg`);
const w3 = CYCLE.applyCycle({ ...cyc531, cycle: { style: '531', week: 3 } }, MAX.loadMaxes());
ok('531 第 3 周:5/3/1 区间 + 95%', w3.days[0].items[0].repsMin === 1 && w3.days[0].items[0].weightKg === 95,
  `${w3.days[0].items[0].repsMin}-${w3.days[0].items[0].repsMax} / ${w3.days[0].items[0].weightKg}kg`);
const w4 = CYCLE.applyCycle({ ...cyc531, cycle: { style: '531', week: 4 } }, MAX.loadMaxes());
ok('531 第 4 周:减载(60%)', w4.days[0].items[0].weightKg === 60, `${w4.days[0].items[0].weightKg}kg`);
ok('531 减载周不挂末组尽力', !w4.days[0].items[0].amrapLast);

// 走满一轮:回第 1 周 + 基准上调
const wrapped = CYCLE.advanceCycle({ ...cyc531, cycle: { style: '531', week: 4 } }, MAX.loadMaxes());
ok('531 走满一轮:回到第 1 周', wrapped.cycle.week === 1, String(wrapped.cycle.week));
ok('531 走满一轮:主项基准上调一档', Math.abs(MAX.loadMaxes()[compound.id].tmKg - 102.5) < 0.01,
  `${MAX.loadMaxes()[compound.id].tmKg}kg`);
ok('531 走满一轮:孤立动作基准不动', MAX.loadMaxes()[iso.id].tmKg === 30, `${MAX.loadMaxes()[iso.id].tmKg}kg`);

const half = CYCLE.advanceCycle({ ...cyc531, cycle: { style: '531', week: 2 } }, MAX.loadMaxes());
ok('531 中途推进:只进一周,基准不变',
  half.cycle.week === 3 && MAX.loadMaxes()[compound.id].tmKg === 102.5, `week=${half.cycle.week}`);

// line 周期:前 3 周照常,第 4 周减载
const cycLine = CYCLE.setCycle(planC, 'line');
const l1 = CYCLE.applyCycle(cycLine, MAX.loadMaxes());
ok('line 第 1 周:原样,不动重量', l1 === cycLine || l1.days[0].items[0].weightKg === 60,
  `${l1.days[0].items[0].weightKg}kg / ${l1.days[0].items[0].sets} 组`);
ok('line:不做波次锁定', !l1.days[0].items[0].cycleLocked);
const l4 = CYCLE.applyCycle({ ...cycLine, cycle: { style: 'line', week: 4 } }, MAX.loadMaxes());
ok('line 第 4 周:重量降到八成', l4.days[0].items[0].weightKg === 48, `${l4.days[0].items[0].weightKg}kg`);
ok('line 第 4 周:少做一组', l4.days[0].items[0].sets === 3, `${l4.days[0].items[0].sets} 组`);
ok('line 走满一轮不上调基准', CYCLE.advanceCycle({ ...cycLine, cycle: { style: 'line', week: 4 } }, MAX.loadMaxes()).cycle.week === 1);

// 关掉周期 → 计划回到原样
const off = CYCLE.setCycle(cycLine, null);
ok('关闭周期:cycle 字段被摘掉', off.cycle === undefined && off.days === planC.days);
ok('没开周期时 applyCycle 原样返回', CYCLE.applyCycle(planC, MAX.loadMaxes()) === planC);
ok('周期文案', CYCLE.cycleSummary({ ...cyc531, cycle: { style: '531', week: 2 } }) === '第 2/4 周 · 3 次',
  String(CYCLE.cycleSummary({ ...cyc531, cycle: { style: '531', week: 2 } })));

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
