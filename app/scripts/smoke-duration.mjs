/**
 * ⑪3 任意秒数休息 / 时长口径 冒烟测试
 * 覆盖 utils/duration.ts:休息处方与倒计时的念法(fmtDuration)、
 * 时长统计的念法(fmtSpan)、休息取值收口(clampRest)与常用预设、
 * 单堂时长的手改收口(spanMinutes/spanSeconds —— 完成页与补录页共用的那一处)。
 * 准备:npx tsc -p tsconfig.smoke.json
 * 用法:node scripts/smoke-duration.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const D = require('../.smoke/utils/duration.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

/* ================= 秒级:休息处方与倒计时 ================= */
ok('0 秒配上 off 就是「不休息」', D.fmtDuration(0, '不休息') === '不休息', D.fmtDuration(0, '不休息'));
ok('不传 off 时 0 就是 0s(计时器用)', D.fmtDuration(0) === '0s');
ok('不到一分钟念秒', D.fmtDuration(45) === '45s' && D.fmtDuration(59) === '59s');
ok('正好一分钟念 1:00', D.fmtDuration(60) === '1:00', D.fmtDuration(60));
ok('一分半念 1:30(不是 90s)', D.fmtDuration(90) === '1:30', D.fmtDuration(90));
ok('两分半念 2:30', D.fmtDuration(150) === '2:30');
ok('三分念 3:00(秒位补零)', D.fmtDuration(180) === '3:00', D.fmtDuration(180));
ok('秒位补零:65 秒不是 1:5', D.fmtDuration(65) === '1:05', D.fmtDuration(65));
ok('休息上限 10 分钟念 10:00', D.fmtDuration(600) === '10:00', D.fmtDuration(600));
ok('整点带小时段', D.fmtDuration(3600) === '1:00:00', D.fmtDuration(3600));
ok('一小时零二分', D.fmtDuration(3720) === '1:02:00', D.fmtDuration(3720));
ok('一小时六分五秒', D.fmtDuration(3965) === '1:06:05', D.fmtDuration(3965));
ok('不足一秒按四舍五入', D.fmtDuration(89.6) === '1:30', D.fmtDuration(89.6));
ok('负数当 0', D.fmtDuration(-5) === '0s' && D.fmtDuration(-5, '不休息') === '不休息');
ok('读不懂的输入不炸', D.fmtDuration(NaN) === '0s' && D.fmtDuration(undefined) === '0s' && D.fmtDuration('90') === '1:30');

/* ================= 分钟级:时长统计 ================= */
ok('不到一分钟按 1 分钟算(假精确没意义)', D.fmtSpan(45) === '1 分钟' && D.fmtSpan(20) === '1 分钟', D.fmtSpan(45));
ok('9 分钟', D.fmtSpan(540) === '9 分钟');
ok('正好一小时只说小时', D.fmtSpan(3600) === '1 小时', D.fmtSpan(3600));
ok('整小时不带零头', D.fmtSpan(7200) === '2 小时', D.fmtSpan(7200));
ok('一小时零二分', D.fmtSpan(3720) === '1 小时 2 分', D.fmtSpan(3720));
ok('两小时零二分', D.fmtSpan(7320) === '2 小时 2 分', D.fmtSpan(7320));
ok('没有数据念破折号', D.fmtSpan(0) === '—' && D.fmtSpan(-5) === '—' && D.fmtSpan(NaN) === '—');
ok('59 分钟还在分钟档', D.fmtSpan(3540) === '59 分钟', D.fmtSpan(3540));
// 59.5 分钟四舍五入到 60 分钟,必须进位成「1 小时」而不是「0 小时 60 分」
ok('四舍五入到整小时会进位', D.fmtSpan(3570) === '1 小时', D.fmtSpan(3570));
ok('一小时差一秒也进位', D.fmtSpan(3595) === '1 小时', D.fmtSpan(3595));

/* ================= 休息取值收口 ================= */
ok('合法值原样通过', D.clampRest(90) === 90 && D.clampRest(0) === 0 && D.clampRest(600) === 600);
ok('超过上限截到 10 分钟', D.clampRest(9999) === D.REST_MAX && D.REST_MAX === 600);
ok('负数收成 0(不休息)', D.clampRest(-5) === 0);
ok('读不懂的收成 0(宁短勿长)', D.clampRest(NaN) === 0 && D.clampRest(undefined) === 0 && D.clampRest('') === 0);
ok('小数取整到秒', D.clampRest(89.6) === 90 && D.clampRest(89.4) === 89);
ok('字符串数字认', D.clampRest('90') === 90);
ok('上限可覆盖', D.clampRest(700, 900) === 700);

/* ================= 预设 ================= */
ok('预设升序且都是合法的整秒', (() => {
  const p = D.REST_PRESETS;
  return p.every((s, i) => Number.isInteger(s) && s >= 0 && s <= D.REST_MAX && (i === 0 || s > p[i - 1]));
})(), JSON.stringify(D.REST_PRESETS));
ok('预设里有「不休息」和三个最常用的', [0, 60, 90, 180].every((s) => D.REST_PRESETS.includes(s)));
ok('预设经过 clampRest 不变', D.REST_PRESETS.every((s) => D.clampRest(s) === s));
ok('每个预设念出来都不一样(免得两个 chip 长一样)', (() => {
  const texts = D.REST_PRESETS.map((s) => D.fmtDuration(s, '不休息'));
  return new Set(texts).size === texts.length;
})(), D.REST_PRESETS.map((s) => D.fmtDuration(s, '不休息')).join(' '));

/* ================= 单堂时长的手改收口(⑧ 手改训练时长) ================= */
// 训练计时是**墙钟**算的,中途接电话/器械被占那次会虚高;补录那次干脆没有墙钟,只有一个
// 按计划估的数。手改出口散在各个页面里,迟早变成「完成页按 5 分钟调、补录页按 1 分钟调」——
// 所以取值范围与步长收口在这一处,两个页面都从这儿拿。
ok('落盘的是整分钟的秒数(不留下「1 小时 12 分零 1 秒」这种假精确)',
  D.spanSeconds(45) === 2700 && D.spanSeconds(72) === 4320);
ok('来回一趟不漂:分钟 → 秒 → 分钟还是它自己', (() => {
  for (let m = D.SPAN_MIN_MIN; m <= D.SPAN_MAX_MIN; m++) if (D.spanMinutes(D.spanSeconds(m)) !== m) return false;
  return true;
})());
ok('填了多少分钟就念多少分钟(1~59 那一档)', (() => {
  for (let m = 1; m < 60; m++) if (D.fmtSpan(D.spanSeconds(m)) !== `${m} 分钟`) return false;
  return true;
})());
ok('手滑填大了截到 6 小时', D.spanSeconds(999) === 6 * 3600 && D.spanSeconds(9999) === 21600 && D.SPAN_MAX_MIN === 360);
ok('下限 1 分钟 —— 和墙钟计时的 60s 下限同一口径', D.spanSeconds(0) === 60 && D.spanSeconds(-5) === 60);
ok('读不懂的输入落到下限,不落到 0(0 分钟不是个意思)',
  D.spanMinutes(NaN) === 1 && D.spanMinutes(undefined) === 1 && D.spanMinutes('') === 1);
ok('零头按最近的分钟取整', D.spanMinutes(4321) === 72 && D.spanMinutes(4349) === 72 && D.spanMinutes(4350) === 73);
ok('字符串数字认(键盘那一格传进来的可能是字符串)', D.spanMinutes('2700') === 45);
ok('在下限上再按一次「−」还是 1 分钟(按钮连点不会掉到 0/负数)',
  D.spanMinutes((D.SPAN_MIN_MIN - D.SPAN_STEP_MIN) * 60) === D.SPAN_MIN_MIN);
ok('在上限上再按一次「＋」还是 6 小时',
  D.spanMinutes((D.SPAN_MAX_MIN + D.SPAN_STEP_MIN) * 60) === D.SPAN_MAX_MIN);
ok('步长 5 分钟且落在上下限之间',
  D.SPAN_STEP_MIN === 5 && D.SPAN_MIN_MIN < D.SPAN_STEP_MIN && D.SPAN_STEP_MIN < D.SPAN_MAX_MIN);

/* ================= 两条口径不打架 ================= */
ok('秒级输出只有两种形状', (() => {
  for (let n = 0; n <= D.REST_MAX; n++) {
    const t = D.fmtDuration(n);
    if (!/^(\d+s|\d+:\d{2})$/.test(t)) return false;
  }
  return true;
})());
ok('分钟级永远不会念出小时以外的单位', (() => {
  for (const n of [1, 59, 60, 61, 3599, 3600, 7200, 86399]) {
    if (!/^(\d+ 分钟|\d+ 小时( \d+ 分)?)$/.test(D.fmtSpan(n))) return false;
  }
  return true;
})());
ok('同一个休息值:计划里的念法与倒计时同源', D.fmtDuration(150, '不休息') === '2:30' && D.fmtDuration(150) === '2:30');

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
