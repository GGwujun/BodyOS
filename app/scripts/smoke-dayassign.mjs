/**
 * 按天改练(engine/dayassign)冒烟测试。
 *
 * 钉的是五件事:
 *   ① **改练优先于轮转** —— 这一天说了练腿,就是腿(训练页、提醒、计划页共用一个入口,
 *      所以这一条错了会同时错三个地方);
 *   ② **计划变了要退回轮转** —— 计划重新生成过、老 key 没了,不能把用户卡在
 *      一个不存在的训练日上;
 *   ③ **按日期过期** —— 改练只对那一天生效,明天照常轮转(它不该变成一次改计划);
 *   ④ **不改轮转本身** —— 改练那天练完之后,轮转照常认得「那天练过了」;
 *   ⑤ **和请假条是两份** —— key 不同、语义不同,合起来存会让「今天不练」和
 *      「今天练另一套」互相覆盖。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-dayassign.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** 假 storage:改练是「写进去还得读得回来」的东西,只测返回值不算数 */
const store = new Map();
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    const taro = {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => store.set(k, v),
      removeStorageSync: (k) => store.delete(k)
    };
    // default 指回自己并标 __esModule —— 包一层的话引擎手里那个 Taro 就是**另一个对象**了
    taro.__esModule = true;
    taro.default = taro;
    return taro;
  }
  return origLoad.call(this, req, ...rest);
};

const A = require('../.smoke/pkg-exercise/engine/dayassign.js');
const Schedule = require('../.smoke/pkg-exercise/engine/schedule.js');
const Nudge = require('../.smoke/pkg-exercise/engine/nudge.js');
const D = require('../.smoke/pkg-exercise/engine/daynote.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/* ===== 和 smoke-nudge / smoke-daynote 同一套造数工具(几处必须同源,否则结论对不上) ===== */
const plan = (keys, daysPerWeek = 3) => ({
  id: 'p1', createdAt: '2026-09-01T00:00:00.000Z', goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek, sessionMin: 45, doneCount: 0, lastNote: '',
  days: keys.map((k, i) => ({ key: k, title: `第 ${i + 1} 天 · ${k}`, focus: '', estMin: 45, items: [] }))
});
const log = (date, dayKey = 'a') => ({ id: `${dayKey}-${date}`, planId: 'p1', dayKey, dayTitle: '', date });

const TODAY = '2026-10-15';
const P3 = plan(['a', 'b', 'c'], 3);

section('清洗 —— 认不出来的条目直接丢,不退回默认值');
ok('空 / 非对象 / 数组 → 空表',
  JSON.stringify(A.sanitizeDayAssigns(null)) === '{}'
  && JSON.stringify(A.sanitizeDayAssigns('x')) === '{}'
  && JSON.stringify(A.sanitizeDayAssigns([])) === '{}');
ok('日期不是真日子 → 丢', JSON.stringify(A.sanitizeDayAssigns({ '2026-2-5': { dayKey: 'a' } })) === '{}');
ok('2 月 30 日 → 丢(得跟原文比对才认得出,new Date 会滚到 3 月)',
  JSON.stringify(A.sanitizeDayAssigns({ '2026-02-30': { dayKey: 'a' } })) === '{}');
ok('dayKey 是空的 / 不是字符串 → 丢',
  JSON.stringify(A.sanitizeDayAssigns({ '2026-10-15': { dayKey: '' } })) === '{}'
  && JSON.stringify(A.sanitizeDayAssigns({ '2026-10-15': { dayKey: 7 } })) === '{}');
ok('正常条目留着', A.sanitizeDayAssigns({ '2026-10-15': { dayKey: 'legs', at: 'x' } })['2026-10-15'].dayKey === 'legs');
ok('at 不是字符串就存空串,不影响这条算数',
  A.sanitizeDayAssigns({ '2026-10-15': { dayKey: 'legs', at: 42 } })['2026-10-15'].at === '');
ok('一坨里混着好的坏的 → 只留好的',
  Object.keys(A.sanitizeDayAssigns({ '2026-10-15': { dayKey: 'legs' }, 'bad': { dayKey: 'a' } })).length === 1);

section('计划里没有的那个训练日 → 退回轮转(计划重新生成过就是这样)');
const ghosts = { [TODAY]: { dayKey: '解散了的那天', at: '' } };
ok('assignOf 露成 null(界面靠它区分显示建议还是显示已改练)',
  A.assignOf(P3, ghosts, TODAY) === null);
ok('resolveDayKey 于是走轮转', A.resolveDayKey(P3, [], ghosts, TODAY) === Schedule.nextDayKey(P3, []));
ok('没有计划时也不炸', A.assignOf(null, ghosts, TODAY) === null);
ok('日期不是真日子 → null', A.assignOf(P3, { '2026-10-15': { dayKey: 'a', at: '' } }, '2026-2-5') === null);

section('改练优先于轮转');
const rotation = Schedule.nextDayKey(P3, []);
const other = P3.days.find((d) => d.key !== rotation).key;
const one = { [TODAY]: { dayKey: other, at: '' } };
ok('说了练那天 → 就是那天', A.resolveDayKey(P3, [], one, TODAY) === other);
ok('而且和轮转**不一样**(这条不成立的话下面几条都是空转)', A.resolveDayKey(P3, [], one, TODAY) !== rotation);
ok('没改的日期照常轮转', A.resolveDayKey(P3, [], one, '2026-10-16') === rotation);
ok('空表 = 完全按轮转', A.resolveDayKey(P3, [], {}, TODAY) === rotation);

section('按日期过期 —— 它不该变成一次改计划');
ok('改的是今天,明天自己就回去了',
  A.resolveDayKey(P3, [], { [TODAY]: { dayKey: other, at: '' } }, '2026-10-16') === rotation);
ok('过去的那些也早就失效了',
  A.resolveDayKey(P3, [], { '2020-01-01': { dayKey: other, at: '' } }, TODAY) === rotation);

section('不改轮转本身 —— 改练那天练完,轮转照常认得');
const afterLogs = [log(TODAY, other)];
ok('练过的那一天不再排最前',
  Schedule.nextDayKey(P3, afterLogs) !== other);
ok('于是明天建议的就是**另一个**训练日',
  A.resolveDayKey(P3, afterLogs, { [TODAY]: { dayKey: other, at: '' } }, '2026-10-16') === Schedule.nextDayKey(P3, afterLogs));

section('写:存得下、读得回、越界的拒绝');
store.clear();
const saved = A.setDayAssign({}, TODAY, 'b', P3, TODAY);
ok('存下来了', saved[TODAY]?.dayKey === 'b');
ok('读得回来', A.loadDayAssigns()[TODAY]?.dayKey === 'b');
ok('存的键就是那个(改键名会一路读到空表,这条防的是手滑)',
  store.has(A.K_DAYASSIGN) && A.K_DAYASSIGN === 'bodyos.training.dayassign');
ok('只改一天不动别的', A.setDayAssign(saved, '2026-10-16', 'c', P3, TODAY)['2026-10-15'].dayKey === 'b');
ok('计划里没有的训练日 → 原样返回,不写',
  A.setDayAssign({}, TODAY, '不存在的', P3, TODAY)[TODAY] === undefined);
ok('没有计划 → 同样不写', A.setDayAssign({}, TODAY, 'a', null, TODAY)[TODAY] === undefined);
ok('太远的将来 → 拒绝', A.setDayAssign({}, '2027-10-15', 'a', P3, TODAY)['2027-10-15'] === undefined);
ok('很久以前 → 拒绝', A.setDayAssign({}, '2019-01-01', 'a', P3, TODAY)['2019-01-01'] === undefined);
ok('今天 = 边界内,收下', A.setDayAssign({}, TODAY, 'a', P3, TODAY)[TODAY]?.dayKey === 'a');
ok('取消 → 回到轮转',
  A.resolveDayKey(P3, [], A.clearDayAssign(A.setDayAssign({}, TODAY, 'b', P3, TODAY), TODAY), TODAY) === rotation);
ok('取消不存在的日期 → 原样返回,不写', A.clearDayAssign({}, TODAY)[TODAY] === undefined);
store.set(A.K_DAYASSIGN, 'garbage');
let threw = false;
let recovered = false;
try { recovered = Object.keys(A.loadDayAssigns()).length === 0; } catch { threw = true; }
ok('storage 里被塞了脏东西 → 空表,不抛', !threw && recovered);

section('未来那几天已经安排好的');
const ahead = { '2026-10-15': { dayKey: 'a', at: '' }, '2026-10-17': { dayKey: 'b', at: '' }, '2020-01-01': { dayKey: 'c', at: '' } };
const up = A.upcomingAssigns(P3, ahead, TODAY);
ok('只列今天及以后,按日期升序', up.map((x) => x.date).join(',') === '2026-10-15,2026-10-17');
ok('带上那天叫什么(界面直接显示,不再自己查一遍)',
  up[0].title === P3.days.find((d) => d.key === 'a').title);
ok('计划里没有的那些不列进来', A.upcomingAssigns(P3, ghosts, TODAY).length === 0);
ok('没有计划 → 空数组', JSON.stringify(A.upcomingAssigns(null, ahead, TODAY)) === '[]');

section('和请假条是两份,不能合并');
ok('两个 storage key 不一样', A.K_DAYASSIGN !== D.K_DAYNOTES);
ok('改练不影响「今天请了假」(那件事归 daynote 管)',
  !D.isExcused({}, TODAY));
ok('所以改练这一天仍然会被提醒 —— 它是「练另一套」,不是「不练」',
  Nudge.nudgeFor({ plan: P3, logs: [], tone: 'gentle', notes: {}, assigns: one }, TODAY)?.dayTitle?.includes(other) === true);

section('提醒和计划页看到的是同一天(这是这个功能存在的理由)');
const n = Nudge.nudgeFor({ plan: P3, logs: [], tone: 'gentle', notes: {}, assigns: one }, TODAY);
ok('提醒卡片说的是改练后那天', n?.dayKey === other);
ok('和 resolveDayKey 一致', n?.dayKey === A.resolveDayKey(P3, [], one, TODAY));
ok('不传 assigns 时退回轮转(老调用点不会因此崩)',
  Nudge.nudgeFor({ plan: P3, logs: [], tone: 'gentle', notes: {} }, TODAY)?.dayKey === rotation);

section('这一层不带用户可见禁词(红线自查)');
import { readFileSync } from 'fs';
import path from 'path';
const src = readFileSync(path.resolve(process.cwd(), 'src/pkg-exercise/engine/dayassign.ts'), 'utf8');
const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
ok('代码里没有禁词(AI / 智能 / 大模型 / 智谱)', !/AI|智能|大模型|智谱/.test(code));

console.log(`\n${fail === 0 ? '全部通过' : `${fail} 项失败`}`);
process.exit(fail === 0 ? 0 : 1);
