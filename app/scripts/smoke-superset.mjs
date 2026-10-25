/**
 * 超级组「轮」冒烟 — engine/superset.ts
 * 覆盖:块划分(相邻同 id,同 id 不相邻是两块)、交替模拟(A1 B1 A2 B2 的走法、
 * 与 workout 勾组找同伴是同一套序)、「＋ 加一组」造成组数不齐、全做完、
 * 解组残留单行、越界/空数组防御。
 * 准备:npx tsc -p tsconfig.smoke.json
 * 用法:node scripts/smoke-superset.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* 纯模块,不碰 Taro —— 但为了和别的套件一个形状(将来谁往 superset.ts 里加 storage 也不至于崩),
   照例装上桩。桩必须在 require 引擎之前。 */
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

const { blockOf, flowOf } = require('../.smoke/pkg-exercise/engine/superset.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/** 造块内行:sets 用 0/1 串表示每组打没打勾('10' = 第1组做完、第2组没做) */
const row = (name, ss, sets = '') => ({
  nameZh: name,
  superset: ss,
  sets: sets.split('').map((c) => ({ done: c === '1' }))
});
const doneAll = (r) => r.sets.every((s) => s.done);

/* ============ 块划分 ============ */
section('块划分(blockOf)');
{
  const rows = [row('卧推', 'a', ''), row('划船', 'a', ''), row('深蹲', '', '')];
  ok('两行同 id 相邻 → 一块', JSON.stringify(blockOf(rows, 0)) === '[0,1]' && JSON.stringify(blockOf(rows, 1)) === '[0,1]');
  ok('无组号的行自成不了块(返回空)', blockOf(rows, 2).length === 0);
  ok('越界行号返回空', blockOf(rows, 9).length === 0 && blockOf([], 0).length === 0);
  const split = [row('卧推', 'a', ''), row('深蹲', '', ''), row('划船', 'a', '')];
  ok('同 id 被普通行隔开 → 两块(块只认相邻)', JSON.stringify(blockOf(split, 0)) === '[0]' && JSON.stringify(blockOf(split, 2)) === '[2]');
  const three = [row('A', 'b', ''), row('B', 'b', ''), row('C', 'b', '')];
  ok('三行连排也是一块(不只支持两动作)', JSON.stringify(blockOf(three, 1)) === '[0,1,2]');
}

/* ============ 交替模拟 ============ */
section('交替模拟(flowOf)');
{
  const rows = [row('卧推', 'a', '10'), row('划船', 'a', '00')];
  const f = flowOf(rows, 0);
  ok('第一个没做的 = 划船第 1 组(轮到同伴)', f.nextRi === 1 && f.nextSi === 0 && f.round === 1, `got ${JSON.stringify(f)}`);

  // 卧推两组都做完、划船只做完第 1 组:第 2 轮里卧推那格已勾,正确答案是把划船第 2 组补上
  // (「每轮都从第一行走一遍」是错的走法 —— 它会把已做完的卧推又报一遍)
  const mid = [row('卧推', 'a', '11'), row('划船', 'a', '10')];
  const f2 = flowOf(mid, 0);
  ok('进第 2 轮后跳过已做的行,下一步是没做的那个', f2.round === 2 && f2.nextRi === 1 && f2.nextSi === 1, `got ${JSON.stringify(f2)}`);
  // 划船先做完两轮、卧推第 2 组没做 → 第 2 轮回到第一行
  const back = [row('卧推', 'a', '10'), row('划船', 'a', '11')];
  const f2b = flowOf(back, 0);
  ok('同伴先做完 → 第 2 轮回到第一行', f2b.round === 2 && f2b.nextRi === 0 && f2b.nextSi === 1, `got ${JSON.stringify(f2b)}`);

  const start = [row('卧推', 'a', '00'), row('划船', 'a', '00')];
  const f3 = flowOf(start, 1);
  ok('全空 → 下一步是块首第 1 组', f3.round === 1 && f3.nextRi === 0 && f3.nextSi === 0);

  const done = [row('卧推', 'a', '11'), row('划船', 'a', '11')];
  const f4 = flowOf(done, 0);
  ok('全做完 → nextRi 为 null,轮数停在总数', f4.nextRi === null && f4.round === 2 && f4.totalRounds === 2);
  ok('总轮数 = 块内最大组数', flowOf([row('卧推', 'a', '000'), row('划船', 'a', '00')], 0).totalRounds === 3);
}

/* ============ 组数不齐(「＋ 加一组」只加在一个动作上) ============ */
section('组数不齐');
{
  // 卧推加到 3 组、划船还是 2 组:第 3 轮只剩卧推 —— 划船 sets[2] 不存在,跳过而不是卡死
  const rows = [row('卧推', 'a', '110'), row('划船', 'a', '110')];
  const f = flowOf(rows, 0);
  ok('缺的那组被跳过,第 3 轮下一步是卧推自己', f.round === 3 && f.nextRi === 0 && f.nextSi === 2, `got ${JSON.stringify(f)}`);

  const done23 = [row('卧推', 'a', '111'), row('划船', 'a', '11')];
  const f2 = flowOf(done23, 1);
  ok('不齐且全做完 → 总轮数按大的算', f2.totalRounds === 3 && f2.nextRi === null);
}

/* ============ 解组残留 / 单行 ============ */
section('单行与防御');
{
  ok('单行带 superset 字段(同伴被移走)→ flowOf 返回 null', flowOf([row('卧推', 'a', '00')], 0) === null);
  ok('普通行 → null', flowOf([row('卧推', undefined, '00')], 0) === null);
  ok('空数组 → null', flowOf([], 0) === null);
  // 中途取消勾选:第 2 轮的划船取消 → 下一步退回它,而不是继续往前
  const rows = [row('卧推', 'a', '11'), row('划船', 'a', '10')];
  const f = flowOf(rows, 0);
  ok('取消勾选后下一步退回没做的那组', f.nextRi === 1 && f.nextSi === 1 && f.round === 2);
}

/* ============ 序与勾组那条规则对齐(同一套走法) ============ */
section('与 toggleSet 找同伴同一套序');
{
  // workout 勾完卧推第1组找同伴:划船第1组没做 → 接着做划船 —— flowOf 的下一步必须也是它
  const rows = [row('卧推', 'a', '10'), row('划船', 'a', '00'), row('弯举', 'a', '00')];
  const f = flowOf(rows, 0);
  ok('三动作块:勾完 A1 → 下一步 B1(不是 C1)', f.nextRi === 1 && f.nextSi === 0);
  const rows2 = [row('卧推', 'a', '11'), row('划船', 'a', '11'), row('弯举', 'a', '10')];
  const f2 = flowOf(rows2, 0);
  ok('A、B 两轮做完 → 第 2 轮轮到 C', f2.nextRi === 2 && f2.nextSi === 1 && f2.round === 2);
  // 全做完的块,doneAll 语义和 flowOf 的 null 对得上
  const all = [row('卧推', 'a', '111'), row('划船', 'a', '11')];
  ok('nextRi=null ⟺ 块内全部打勾', flowOf(all, 0).nextRi === null && all.every(doneAll));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAIL`}`);
process.exit(fail === 0 ? 0 : 1);
