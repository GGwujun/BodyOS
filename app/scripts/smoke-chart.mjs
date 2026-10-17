/**
 * 折线图判据 冒烟测试
 * 覆盖 utils/chart.ts:纵轴的范围与刻度(chartDomain/axisText)、
 * 点选落在第几个点(pickIndex)、读数上的数字(valueText)。
 * 准备:npx tsc -p tsconfig.smoke.json
 * 用法:node scripts/smoke-chart.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../.smoke/utils/chart.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

section('纵轴范围:向外取整到好看的刻度');
const w = C.chartDomain([64.2, 65.1, 70.5]);
ok('范围把数据包住', w.min <= 64.2 && w.max >= 70.5, `${w.min} ~ ${w.max}(步长 ${w.step})`);
ok('两端落在步长的整数倍上(刻度念得出来)', w.min % w.step === 0 && w.max % w.step === 0,
  `${w.min} / ${w.max} / ${w.step}`);
ok('范围没有撑得离谱(不超过数据跨度的两倍)', w.max - w.min <= (70.5 - 64.2) * 2, `${(w.max - w.min).toFixed(1)}`);
ok('整数体重不带小数尾', C.axisText(w.min, w.step) === String(w.min) && C.axisText(w.max, w.step) === String(w.max),
  `${C.axisText(w.min, w.step)} / ${C.axisText(w.max, w.step)}`);

const bmi = C.chartDomain([22.1, 22.6]);
ok('BMI 这种窄范围用得上小数刻度', bmi.step < 1, `步长 ${bmi.step}`);
ok('窄范围的标签带一位小数', C.axisText(bmi.min, bmi.step).includes('.') || bmi.step >= 1,
  C.axisText(bmi.min, bmi.step));
ok('窄范围也把数据包住', bmi.min <= 22.1 && bmi.max >= 22.6, `${bmi.min} ~ ${bmi.max}`);

section('目标线:算域时必须把它包进来');
const withTarget = C.chartDomain([70.1, 70.8, 71.2], 65);
ok('目标在数据之外也画得进来', withTarget.min <= 65 && withTarget.max >= 71.2, `${withTarget.min} ~ ${withTarget.max}`);
ok('目标落在刻度上', Math.abs(withTarget.min / withTarget.step - Math.round(withTarget.min / withTarget.step)) < 1e-9);
const noTarget = C.chartDomain([70.1, 70.8, 71.2]);
ok('不给目标时范围紧得多', (noTarget.max - noTarget.min) < (withTarget.max - withTarget.min),
  `${noTarget.min}~${noTarget.max} vs ${withTarget.min}~${withTarget.max}`);
const targetInside = C.chartDomain([60, 80], 70);
ok('目标在数据之内时不改变范围', targetInside.min === 60 && targetInside.max === 80, `${targetInside.min} ~ ${targetInside.max}`);

section('目标线该不该画:太远就不画,免得把曲线压平');
ok('目标落在一堆体重里 —— 画', C.worthTarget([70.1, 70.8, 71.2], 71) === true);
ok('目标在数据之外一点 —— 也画', C.worthTarget([70.1, 70.8, 71.2], 69.5) === true);
ok('目标远到把纵轴拉长一倍以上 —— 不画', C.worthTarget([70.1, 70.8, 71.2], 65) === false);
ok('BMI 30 的人画 23.9 那条线会压平曲线 —— 不画', C.worthTarget([29.8, 30.1, 30.2], 23.9) === false);
ok('BMI 24.5 的人 —— 画', C.worthTarget([23.6, 24.2, 24.5], 23.9) === true);
/* 数据 10~20(跨度 10),目标 0 时跨度正好 20 —— 界线本身算画 */
ok('跨度刚好涨到两倍 —— 画(边界含在内)', C.worthTarget([10, 20], 0) === true);
ok('刚过两倍 —— 不画', C.worthTarget([10, 20], -0.1) === false);
ok('一个数据点也判得出来', C.worthTarget([65], 66) === true && C.worthTarget([65], 40) === false);
ok('没给目标 / 目标读不懂 —— 不画', C.worthTarget([70], null) === false
  && C.worthTarget([70], undefined) === false && C.worthTarget([70], NaN) === false);
ok('序列是空的 —— 不画', C.worthTarget([], 65) === false);
/* 不滤脏数据的话 min/max 会变成 NaN,比较全 false —— 这条就是钉那个 */
ok('脏数据不参与判断', C.worthTarget([70.1, NaN, 71], 69.5) === true);

section('只有一个值 / 没有值:不能除零、不能给 NaN');
const one = C.chartDomain([65]);
ok('单点也给得出一个非零的范围', one.max > one.min && Number.isFinite(one.min) && Number.isFinite(one.max),
  `${one.min} ~ ${one.max}`);
ok('单点的步长是正数', one.step > 0);
const none = C.chartDomain([]);
ok('没数据也返回可用的域(不是 NaN)', Number.isFinite(none.min) && Number.isFinite(none.max) && none.max > none.min,
  `${none.min} ~ ${none.max}`);
ok('没数据时值和标签都不炸', C.valueText(NaN) === '—' && C.axisText(NaN, 1) === '');
const dirty = C.chartDomain([1, NaN, 3, Infinity]);
ok('脏数据不参与算域', dirty.min <= 1 && dirty.max >= 3, `${dirty.min} ~ ${dirty.max}`);

section('刻度上的字');
ok('步长 2 不念小数', C.axisText(64, 2) === '64');
ok('步长 0.5 念一位', C.axisText(65.5, 0.5) === '65.5', C.axisText(65.5, 0.5));
ok('上万折成「万」', C.axisText(12000, 2000) === '1.2万', C.axisText(12000, 2000));
ok('负数也念得出来', C.axisText(-2.5, 0.5) === '-2.5', C.axisText(-2.5, 0.5));

section('点选:落在第几个点上');
/* 绘图区从 left=34 起、宽 260,7 个点 → 每格 260/6 ≈ 43.3 */
const L = 34;
const W = 260;
const N = 7;
ok('点最左边那个点', C.pickIndex(L, L, W, N) === 0);
ok('点中间的点', C.pickIndex(L + (W / (N - 1)) * 3, L, W, N) === 3);
ok('点最右边那个点', C.pickIndex(L + W, L, W, N) === N - 1);
ok('偏半格以内算最近的那个', C.pickIndex(L + W / (N - 1) * 2 + 12, L, W, N) === 2,
  String(C.pickIndex(L + W / (N - 1) * 2 + 12, L, W, N)));
ok('过了半格就算下一个', C.pickIndex(L + W / (N - 1) * 2 + 30, L, W, N) === 3);
ok('点在刻度那一栏(左边留白)算第一个', C.pickIndex(2, L, W, N) === 0);
ok('点在图外面(右边)算最后一个', C.pickIndex(9999, L, W, N) === N - 1);
ok('负坐标也兜得住', C.pickIndex(-50, L, W, N) === 0);
ok('单个点时永远第 0 个', C.pickIndex(120, L, W, 1) === 0 && C.pickIndex(0, L, W, 1) === 0);
ok('宽度算不出来时回 0(不是 NaN)', C.pickIndex(120, L, 0, N) === 0 && C.pickIndex(120, L, NaN, N) === 0);
ok('结果永远是合法下标', [...Array(50)].every((_, i) =>
  C.pickIndex(i * 7 - 100, L, W, N) >= 0 && C.pickIndex(i * 7 - 100, L, W, N) <= N - 1));

section('读数上的数字');
ok('整数不带小数点', C.valueText(8000) === '8000');
ok('小数留一位', C.valueText(65.24) === '65.2' && C.valueText(22) === '22');
ok('0 也是 0', C.valueText(0) === '0');
ok('读不懂就是破折号', C.valueText(NaN) === '—' && C.valueText(Infinity) === '—');

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
