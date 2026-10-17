/**
 * ⑪4 训练中调序 冒烟测试
 * 覆盖 engine/order.ts:块的划分、落单超级组的解散、训练中「整块走」与计划里
 * 「走一步、走开了就解散」两种移动、训练中插一行(加练一个动作),
 * 以及编辑器(engine/editor.ts)接上去以后的行为。
 * 准备:npx tsc -p tsconfig.smoke.json
 * 用法:node scripts/smoke-order.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* mock Taro:引擎模块(store/fav/custom…)会 import 它,而真 Taro 在 Node 下起不来
   (它要小程序编译期注入的常量)。mock 必须在 require 引擎模块**之前**装好。 */
const mem = new Map();
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); }
};
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: storage, ...storage };
  return origLoad.call(this, req, ...rest);
};

const O = require('../.smoke/pkg-exercise/engine/order.js');
const E = require('../.smoke/pkg-exercise/engine/editor.js');
const { generatePlan } = require('../.smoke/pkg-exercise/engine/generator.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/** 造行:'a' → 无组号;['a','s1'] → 带组号 */
const rows = (...specs) => specs.map((s) => (Array.isArray(s) ? { id: s[0], superset: s[1] } : { id: s }));
const ids = (rs) => rs.map((r) => r.id).join('');
const sgs = (rs) => rs.map((r) => r.superset ?? '-').join(',');
const unitsOf = (rs) => JSON.stringify(O.orderUnits(rs));

/* ================= 哪些行是一块 ================= */
section('块的划分');
ok('相邻且同组号算一块', unitsOf(rows(['a', 's1'], ['b', 's1'], 'c')) === '[[0,1],[2]]', unitsOf(rows(['a', 's1'], ['b', 's1'], 'c')));
ok('没有组号就是各自一块', unitsOf(rows('a', 'b', 'c')) === '[[0],[1],[2]]');
ok('隔开的同组号不算一块(那是坏数据)', unitsOf(rows(['a', 's1'], 'c', ['b', 's1'])) === '[[0],[1],[2]]');
ok('三成员也能成一块', unitsOf(rows(['a', 's1'], ['b', 's1'], ['c', 's1'], 'd')) === '[[0,1,2],[3]]');
ok('两对分开的组是两个块', unitsOf(rows(['a', 's1'], ['b', 's1'], ['c', 's2'], ['d', 's2'])) === '[[0,1],[2,3]]');
ok('空列表没有块', unitsOf([]) === '[]');
ok('找块:空下标给空数组', O.unitOf(O.orderUnits(rows('a')), 7).length === 0);
ok('有同伴才算「超级组成员」', O.inUnit(rows(['a', 's1'], ['b', 's1']), 0) === true && O.inUnit(rows(['a', 's1'], 'c'), 0) === false);

/* ================= 落单的超级组 ================= */
section('解散落单的超级组');
ok('同伴被隔开 → 两个成员都摘掉组号', (() => {
  const rs = O.cleanUnits(rows(['a', 's1'], 'c', ['b', 's1']));
  return sgs(rs) === '-,-,-';
})(), sgs(O.cleanUnits(rows(['a', 's1'], 'c', ['b', 's1']))));
ok('完整的一对原样不动(同一个引用,免得白重渲染)', (() => {
  const rs = rows(['a', 's1'], ['b', 's1'], 'c');
  return O.cleanUnits(rs) === rs;
})());
ok('本来就没有组号也返回同一个引用', (() => {
  const rs = rows('a', 'b');
  return O.cleanUnits(rs) === rs;
})());
ok('只摘落单的,不动好的一对', (() => {
  const rs = O.cleanUnits(rows(['a', 's1'], ['b', 's1'], ['lone', 's9']));
  return sgs(rs) === 's1,s1,-';
})(), sgs(O.cleanUnits(rows(['a', 's1'], ['b', 's1'], ['lone', 's9']))));
ok('不原地改传进来的行', (() => {
  const input = rows(['a', 's1'], 'c', ['b', 's1']);
  O.cleanUnits(input);
  return input[0].superset === 's1' && input[2].superset === 's1';
})());

/* ================= 训练中:整块走 ================= */
section('训练中调序(整块走)');
ok('组内换位:两个成员换,块不动', (() => {
  const m = O.moveWorkoutRow(rows(['a', 's1'], ['b', 's1'], 'c'), 0, 1);
  return ids(m.rows) === 'bac' && m.to === 1 && m.dissolved === 0 && sgs(m.rows) === 's1,s1,-';
})(), (() => { const m = O.moveWorkoutRow(rows(['a', 's1'], ['b', 's1'], 'c'), 0, 1); return `${ids(m.rows)} to=${m.to}`; })());
ok('组内反向换位就是换回来', ids(O.moveWorkoutRow(rows(['a', 's1'], ['b', 's1'], 'c'), 1, -1).rows) === 'bac');
ok('成员在组的边缘 → 带着整块越过前一个', (() => {
  const m = O.moveWorkoutRow(rows('x', ['a', 's1'], ['b', 's1']), 1, -1);
  return ids(m.rows) === 'abx' && m.to === 0 && m.dissolved === 0 && JSON.stringify(m.order) === '[1,2,0]';
})(), JSON.stringify(O.moveWorkoutRow(rows('x', ['a', 's1'], ['b', 's1']), 1, -1)));
ok('整块往下走也一样(按在组的最后一个成员上)', (() => {
  const m = O.moveWorkoutRow(rows(['a', 's1'], ['b', 's1'], 'x', 'y'), 1, 1);
  return ids(m.rows) === 'xaby' && m.to === 2;
})(), (() => { const m = O.moveWorkoutRow(rows(['a', 's1'], ['b', 's1'], 'x', 'y'), 1, 1); return `${ids(m.rows)} to=${m.to}`; })());
// 按在组的第一个成员上时,邻居就是同伴 —— 那是组内换位,不是整块走(和 openGym 一致)
ok('按在组内成员上永远是换位,不会整块走', (() => {
  const m = O.moveWorkoutRow(rows(['a', 's1'], ['b', 's1'], 'x', 'y'), 0, 1);
  return ids(m.rows) === 'baxy' && m.to === 1 && m.dissolved === 0;
})(), ids(O.moveWorkoutRow(rows(['a', 's1'], ['b', 's1'], 'x', 'y'), 0, 1).rows));
ok('三成员的块整体越过一个动作', (() => {
  const m = O.moveWorkoutRow(rows('x', ['a', 's1'], ['b', 's1'], ['c', 's1'], 'y'), 3, 1);
  return ids(m.rows) === 'xyabc' && m.to === 4;
})(), ids(O.moveWorkoutRow(rows('x', ['a', 's1'], ['b', 's1'], ['c', 's1'], 'y'), 3, 1).rows));
ok('单个动作会跳过整个超级组(不是钻进去)', (() => {
  const m = O.moveWorkoutRow(rows('x', ['a', 's1'], ['b', 's1']), 0, 1);
  return ids(m.rows) === 'abx' && m.to === 2;
})(), ids(O.moveWorkoutRow(rows('x', ['a', 's1'], ['b', 's1']), 0, 1).rows));
ok('训练中永远不会把超级组拆开', (() => {
  const base = rows('x', ['a', 's1'], ['b', 's1'], 'y');
  for (let i = 0; i < base.length; i++) {
    for (const d of [-1, 1]) {
      const m = O.moveWorkoutRow(base, i, d);
      if (m && O.cleanUnits(m.rows) !== m.rows) return false;
    }
  }
  return true;
})());
ok('order 是新位置→旧位置的置换(页面靠它搬热身打勾这些按行号记的状态)', (() => {
  const base = rows('x', ['a', 's1'], ['b', 's1'], 'y');
  const m = O.moveWorkoutRow(base, 3, -1);
  const sorted = [...m.order].sort((a, b) => a - b).join(',');
  return ids(m.rows) === 'xyab' && sorted === '0,1,2,3' && m.order.every((old, i) => m.rows[i] === base[old]);
})(), JSON.stringify(O.moveWorkoutRow(rows('x', ['a', 's1'], ['b', 's1'], 'y'), 3, -1).order));

section('训练中调序:边界与脏输入');
const five = rows('x', ['a', 's1'], ['b', 's1'], 'y', 'z');
ok('第一个不能再上移', O.moveWorkoutRow(five, 0, -1) === null);
ok('最后一个不能再下移', O.moveWorkoutRow(five, 4, 1) === null);
ok('空列表不炸', O.moveWorkoutRow([], 0, 1) === null);
ok('下标越界不炸', O.moveWorkoutRow(five, 9, 1) === null && O.moveWorkoutRow(five, -1, 1) === null);
ok('方向不是 ±1 不炸', O.moveWorkoutRow(five, 1, 0) === null && O.moveWorkoutRow(five, 1, 2) === null);
ok('按钮禁用态和「移得动」完全一致', (() => {
  for (let i = 0; i < five.length; i++) {
    for (const d of [-1, 1]) {
      if (O.canMoveWorkoutRow(five, i, d) !== (O.moveWorkoutRow(five, i, d) !== null)) return false;
    }
  }
  return O.canMoveWorkoutRow(five, 0, -1) === false && O.canMoveWorkoutRow(five, 0, 1) === true;
})());

/* ================= 训练中插一行(加练一个动作) ================= */
section('训练中插一行');
const ins = (rs, i, id = 'n') => O.insertWorkoutRow(rs, i, { id });
ok('单独一个动作:插在它后面', ids(ins(rows('a', 'b'), 0).rows) === 'anb', ids(ins(rows('a', 'b'), 0).rows));
// 插在超级组成员中间会把那一块劈成两半 —— 两个隔开的成员各挂一个组号,正是 cleanUnits 要收拾的坏数据
ok('插点落在块的末尾,不是那个成员的后面',
  // 第一块之后:插在块首成员上也是整块之后
  ids(ins(rows(['a', 's1'], ['b', 's1'], 'c'), 0).rows) === 'abnc'
  // 前面还有别的动作:块整体后移的那个位置,不是「行号 +1」
  && ids(ins(rows('x', ['a', 's1'], ['b', 's1']), 1).rows) === 'xabn'
  // 插在块尾成员上,结果一样
  && ids(ins(rows(['a', 's1'], ['b', 's1'], 'c'), 1).rows) === 'abnc',
  `${ids(ins(rows(['a', 's1'], ['b', 's1'], 'c'), 0).rows)} / ${ids(ins(rows('x', ['a', 's1'], ['b', 's1']), 1).rows)}`);
ok('三成员的块也是整块之后', ids(ins(rows(['a', 's1'], ['b', 's1'], ['c', 's1']), 1).rows) === 'abcn',
  ids(ins(rows(['a', 's1'], ['b', 's1'], ['c', 's1']), 1).rows));
ok('插在最后一个动作之后就是追加', ids(ins(rows('a', 'b'), 1).rows) === 'abn');
ok('新行不继承组号(它是单独一块,不是被塞进超级组)', (() => {
  const r = ins(rows(['a', 's1'], ['b', 's1'], 'c'), 0);
  return r.rows[2].superset === undefined && r.rows[2].id === 'n';
})());
ok('插完不留坏数据,块的划分符合预期', (() => {
  const r = ins(rows(['a', 's1'], ['b', 's1'], 'c'), 0);
  return O.cleanUnits(r.rows) === r.rows && JSON.stringify(O.orderUnits(r.rows)) === '[[0,1],[2],[3]]';
})(), JSON.stringify(O.orderUnits(ins(rows(['a', 's1'], ['b', 's1'], 'c'), 0).rows)));
ok('order 是新位置→旧位置,插进来的那一行占位 -1(页面靠它搬热身打勾这些状态)', (() => {
  const base = rows('x', ['a', 's1'], ['b', 's1'], 'y');
  const r = ins(base, 1);
  const n = r.rows.length;
  const kept = r.order.filter((o) => o !== -1);
  return r.order.length === n
    && r.order.filter((o) => o === -1).length === 1
    && kept.join(',') === base.map((_, i) => i).join(',')   // 去掉占位格,老行一个不少、一个不重
    && r.order.every((old, i) => old === -1 || r.rows[i] === base[old]);
})(), JSON.stringify(ins(rows('x', ['a', 's1'], ['b', 's1'], 'y'), 1).order));
ok('占位那一格只落在新行上(搬状态的人查不到它,因为它本来就是全新的)', (() => {
  const r = ins(rows('a', 'b'), 0);
  return r.order.indexOf(-1) === 1 && r.rows[1].id === 'n';
})());
ok('空列表 / 越界下标不炸', O.insertWorkoutRow([], 0, { id: 'n' }) === null
  && ins(five, -1) === null && ins(five, 5) === null);

/* ================= 计划里:一次一步 ================= */
section('计划里调序(走开了就解散)');
ok('组内换位和训练中一样', (() => {
  const m = O.movePlanItem(rows(['a', 's1'], ['b', 's1'], 'c'), 0, 1);
  return ids(m.rows) === 'bac' && m.dissolved === 0 && sgs(m.rows) === 's1,s1,-';
})());
ok('成员挪出相邻位置 → 这个组解散', (() => {
  const m = O.movePlanItem(rows('x', ['a', 's1'], ['b', 's1']), 1, -1);
  return ids(m.rows) === 'axb' && m.dissolved === 2 && sgs(m.rows) === '-,-,-';
})(), (() => { const m = O.movePlanItem(rows('x', ['a', 's1'], ['b', 's1']), 1, -1); return `${ids(m.rows)} dissolved=${m.dissolved} ${sgs(m.rows)}`; })());
ok('三成员组里挪走一个,剩下两个还算一组', (() => {
  const m = O.movePlanItem(rows('x', ['a', 's1'], ['b', 's1'], ['c', 's1']), 1, -1);
  return ids(m.rows) === 'axbc' && m.dissolved === 1 && sgs(m.rows) === '-,-,s1,s1';
})(), (() => { const m = O.movePlanItem(rows('x', ['a', 's1'], ['b', 's1'], ['c', 's1']), 1, -1); return `${ids(m.rows)} dissolved=${m.dissolved} ${sgs(m.rows)}`; })());
ok('一个动作也能钻出来(位置真的动了一步)', (() => {
  const m = O.movePlanItem(rows(['a', 's1'], ['b', 's1'], 'c'), 1, 1);
  return ids(m.rows) === 'acb' && m.dissolved === 2;
})());
ok('陈年的孤儿组号被走过时顺手摘掉,但不谎报「超级组解散」', (() => {
  const m = O.movePlanItem(rows('x', ['a', 's9'], 'y'), 1, 1);
  return ids(m.rows) === 'xya' && m.dissolved === 0;
})());
ok('走完不会留下「隔开的同组号」', (() => {
  const base = rows('x', ['a', 's1'], ['b', 's1'], 'y');
  for (let i = 0; i < base.length; i++) {
    for (const d of [-1, 1]) {
      const m = O.movePlanItem(base, i, d);
      if (m && O.cleanUnits(m.rows) !== m.rows) return false;
    }
  }
  return true;
})());
ok('计划里的边界同样移不动', (() => {
  return O.movePlanItem(five, 0, -1) === null && O.movePlanItem(five, 4, 1) === null && O.movePlanItem([], 0, 1) === null;
})());

/* ================= 接到编辑器上 ================= */
section('编辑器接上以后');
const plan0 = generatePlan({ goal: 'muscle', level: 'beginner', access: 'gym', daysPerWeek: 3, sessionMin: 45 });
const paired = E.toggleSuperset(plan0, 0, 0);
ok('编辑器能配出超级组(后面几条靠它)', Boolean(paired.days[0].items[0].superset)
  && paired.days[0].items[0].superset === paired.days[0].items[1].superset);
ok('组内换位后这两个动作还是一组', (() => {
  const moved = E.moveItem(paired, 0, 0, 1);
  const [a, b] = moved.days[0].items;
  return a.superset && a.superset === b.superset
    && a.exerciseId === paired.days[0].items[1].exerciseId
    && b.exerciseId === paired.days[0].items[0].exerciseId;
})());
ok('挪出相邻位置 → 编辑器报「解散了 2 个」且两边组号都没了', (() => {
  // 第一对就在队首,往上没地方走 —— 换个位置:把 1、2 配成组再让它往上走
  const mid = E.toggleSuperset(plan0, 0, 1);
  const res = E.moveItemDetailed(mid, 0, 1, -1);
  const items = res.plan.days[0].items;
  return res.dissolved === 2 && !items[0].superset && !items[1].superset
    && items[0].exerciseId === mid.days[0].items[1].exerciseId
    && items[1].exerciseId === mid.days[0].items[0].exerciseId;
})(), JSON.stringify(E.moveItemDetailed(E.toggleSuperset(plan0, 0, 1), 0, 1, -1)?.dissolved));
ok('移不动时编辑器和页面都拿得到「没动」', (() => {
  return E.moveItem(paired, 0, 0, -1) === paired && E.moveItemDetailed(paired, 0, 0, -1) === null;
})());
ok('删掉同伴 → 剩下的那个不再是超级组', (() => {
  const left = E.removeItem(paired, 0, 0);
  return !left.days[0].items[0].superset;
})(), JSON.stringify(E.removeItem(paired, 0, 0).days[0].items[0].superset));
ok('删掉不在组里的动作不影响别的组', (() => {
  const p2 = E.toggleSuperset(plan0, 0, 2);
  const left = E.removeItem(p2, 0, 0);
  const [a, b] = [left.days[0].items[1], left.days[0].items[2]];
  return a.superset && a.superset === b.superset;
})());

section('读计划时修一遍老数据');
ok('拆散的组在入口就被修好,好的那组原样不动,别的训练日同一个引用', (() => {
  const good = E.toggleSuperset(plan0, 0, 1);          // 1、2 配成一组
  const broken = {
    ...good,
    days: good.days.map((d, i) => (i !== 0 ? d : {
      ...d,
      items: d.items.map((it, ii) => (ii === 0 ? { ...it, superset: 'ss-old' } : it))   // 队首留个孤儿组号
    }))
  };
  const fixed = O.cleanPlanUnits(broken);
  const [a, b, c] = fixed.days[0].items;
  return fixed !== broken
    && !a.superset                                   // 孤儿组号摘掉
    && b.superset && b.superset === c.superset       // 好的一组照旧
    && fixed.days[1] === broken.days[1] && fixed.days[2] === broken.days[2];
})(), JSON.stringify(O.cleanPlanUnits((() => {
  const good = E.toggleSuperset(plan0, 0, 1);
  return { ...good, days: good.days.map((d, i) => (i !== 0 ? d : { ...d, items: d.items.map((it, ii) => (ii === 0 ? { ...it, superset: 'ss-old' } : it)) })) };
})()).days[0].items.map((it) => it.superset ?? '-').join(',')));
ok('好计划原样返回(同一个引用)', O.cleanPlanUnits(paired) === paired);
ok('修完的计划还是能正常调序', (() => {
  const fixed = O.cleanPlanUnits(paired);
  const m = E.moveItemDetailed(fixed, 0, 0, 1);
  return m !== null && m.dissolved === 0 && Boolean(m.plan.days[0].items[0].superset);
})());

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
