/**
 * ⑪2 体重周均值 冒烟测试
 * 覆盖 utils/weekly-weight.ts(按周汇总)与它依赖的 utils/date.ts 周算术。
 * 准备:npx tsc -p tsconfig.smoke.json
 * 用法:node scripts/smoke-weekly.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const W = require('../.smoke/utils/weekly-weight.js');
const D = require('../.smoke/utils/date.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const r = (date, weightKg) => ({ date, weightKg });

/* ================= 日期:一周从周一开始 ================= */
// 2026-10-08 是周四(smoke-history 里同一个锚点),10-15 也是周四 → 周一 10-12
ok('周四归到本周一', D.mondayOf('2026-10-15') === '2026-10-12', D.mondayOf('2026-10-15'));
ok('周一归到自己', D.mondayOf('2026-10-12') === '2026-10-12');
ok('周日算上一周', D.mondayOf('2026-10-18') === '2026-10-12', D.mondayOf('2026-10-18'));
ok('跨月的周日也归上一周', D.mondayOf('2026-11-01') === '2026-10-26', D.mondayOf('2026-11-01'));
ok('周日和紧随其后的周一是两周', D.mondayOf('2026-10-11') !== D.mondayOf('2026-10-12'));

/* ================= 日期:加减与差值 ================= */
ok('差一天', D.dayDiff('2026-10-31', '2026-11-01') === 1);
ok('跨年差值', D.dayDiff('2026-12-31', '2027-01-01') === 1);
ok('往前是负数', D.dayDiff('2026-10-12', '2026-10-05') === -7);
ok('同一天为 0', D.dayDiff('2026-10-12', '2026-10-12') === 0);
ok('加一天跨年', D.addDays('2026-12-31', 1) === '2027-01-01', D.addDays('2026-12-31', 1));
ok('减一天跨月', D.addDays('2026-11-01', -1) === '2026-10-31', D.addDays('2026-11-01', -1));
ok('加减 7 天=同一周的另一天', D.mondayOf(D.addDays('2026-10-15', 7)) === '2026-10-19');
ok('往返不丢一天(本地时区)', D.isoOf(D.parseDay('2026-10-05')) === '2026-10-05', D.isoOf(D.parseDay('2026-10-05')));
ok('todayStr 是 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(D.todayStr()), D.todayStr());

/* ================= 分桶与均值 ================= */
const one = W.weeklyWeights([
  r('2026-10-12', 66.0), r('2026-10-14', 66.6), r('2026-10-15', 67.2)    // 同一周(周一~周四)
]);
ok('一周合成一条', one.length === 1);
ok('均值算对了', one[0].avg === 66.6, String(one[0].avg));
ok('次数算对了', one[0].n === 3);
ok('周区间是周一到周日', one[0].start === '2026-10-12' && one[0].end === '2026-10-18');
ok('第一周没有可比对象', one[0].delta === null && one[0].prevStart === null);

// 10-11(周日)属于上一周,不能和 10-12 混在一起
const boundary = W.weeklyWeights([r('2026-10-11', 70), r('2026-10-12', 66)]);
ok('周日的记录不会被算进下周一那周', boundary.length === 2 && boundary.find((w) => w.start === '2026-10-12').avg === 66,
  JSON.stringify(boundary.map((w) => [w.start, w.avg])));

/* ================= 排掉脏数据 ================= */
const dirty = W.weeklyWeights([
  r('2026-10-12', 66),
  r('2026-10-13', 0),          // 体重 0 是「没量」,不是「0 公斤」
  r('2026-10-14', -3),
  { date: '', weightKg: 80 },  // 没有日期
  { weightKg: 90 }             // 连字段都没有
]);
ok('体重 ≤ 0 的不参与平均', dirty[0].avg === 66 && dirty[0].n === 1, JSON.stringify([dirty[0].avg, dirty[0].n]));
ok('没有日期的记录被丢掉', W.weeklyWeights([{ weightKg: 80 }]).length === 0);
ok('空输入不炸', W.weeklyWeights([]).length === 0 && W.weeklyWeights(null).length === 0 && W.weeklyWeights(undefined).length === 0);

/* ================= 周与周之间的变化 ================= */
const two = W.weeklyWeights([
  r('2026-10-05', 67.0), r('2026-10-07', 66.6),   // 上周均值 66.8
  r('2026-10-12', 66.2), r('2026-10-14', 65.8)    // 本周均值 66.0
]);
ok('新的周在前', two[0].start === '2026-10-12' && two[1].start === '2026-10-05');
ok('变化量 = 本周均值 - 上周均值', two[0].delta === -0.8, String(two[0].delta));
ok('变化量说明比的是哪一周', two[0].prevStart === '2026-10-05');
ok('上周那条自己带值', two[1].avg === 66.8, String(two[1].avg));

// 中间整整两周没称:比的是「上一个有记录的周」,不是「上一周」——而且要说清楚
const gap = W.weeklyWeights([r('2026-10-05', 68), r('2026-10-26', 66)]);
ok('漏称的周不会以 0kg 参与', gap.length === 2);
ok('跳过空周去比上一次有记录的周', gap[0].delta === -2 && gap[0].prevStart === '2026-10-05',
  JSON.stringify([gap[0].delta, gap[0].prevStart]));
ok('差了几周算得出来', W.weeksApart('2026-10-05', '2026-10-26') === 3);
ok('相邻周差 1 周', W.weeksApart('2026-10-05', '2026-10-12') === 1);

/* ================= 组内顺序与同一周多次 ================= */
const dup = W.weeklyWeights([r('2026-10-12', 66), r('2026-10-15', 68), r('2026-10-13', 67)]);
ok('同一周里的记录新的在前', dup[0].entries.map((e) => e.date).join(',') === '2026-10-15,2026-10-13,2026-10-12');
ok('同一天称两次都算(均值取两者)', (() => {
  const w = W.weeklyWeights([r('2026-10-12', 66), r('2026-10-12', 67)]);
  return w[0].n === 2 && w[0].avg === 66.5;
})(), JSON.stringify(W.weeklyWeights([r('2026-10-12', 66), r('2026-10-12', 67)])[0].avg));
ok('乱序输入也能分对周', W.weeklyWeights([r('2026-10-15', 65), r('2026-10-05', 67), r('2026-10-14', 66)]).map((w) => w.start).join(',') === '2026-10-12,2026-10-05');

/* ================= 精度与边界 ================= */
const round = W.weeklyWeights([r('2026-10-12', 65), r('2026-10-13', 66), r('2026-10-14', 66)]);
ok('均值保留两位小数', round[0].avg === 65.67, String(round[0].avg));
const endMonth = W.weeklyWeights([r('2026-10-28', 66)]);
ok('周区间可以跨月', endMonth[0].start === '2026-10-26' && endMonth[0].end === '2026-11-01', `${endMonth[0].start}~${endMonth[0].end}`);
ok('所有有效记录都被算进某个周', (() => {
  const recs = [r('2026-10-05', 67), r('2026-10-06', 66), r('2026-10-13', 65), r('2026-10-21', 64.5), r('2026-11-02', 64)];
  const sum = W.weeklyWeights(recs).reduce((n, w) => n + w.n, 0);
  return sum === recs.length;
})());

/* ================= 变化量文案与方向 ================= */
const D_ = W.weekDelta;
ok('没有上周时念破折号', D_(null).text === '—' && D_(null).dir === 0);
ok('降了念负号', D_(-0.6).text === '-0.6 kg' && D_(-0.6).dir === -1, D_(-0.6).text);
ok('升了念正号', D_(0.4).text === '+0.4 kg' && D_(0.4).dir === 1, D_(0.4).text);
ok('几乎没有变化念没变', D_(0.05).text === '没变' && D_(-0.04).text === '没变');
ok('没变的方向是 0(页面才会用中性色)', D_(0.05).dir === 0 && D_(0).dir === 0);
ok('0.3 公斤是正经的一周成果,不能被念成没变', D_(-0.3).text === '-0.3 kg', D_(-0.3).text);
ok('刚好到阈值就念出来', D_(0.1).text === '+0.1 kg' && D_(0.1).dir === 1, D_(0.1).text);
// 文案和方向必须同源:阈值的两边界不能一个说没变、一个给方向
ok('阈值的两侧文案与方向一致', (() => {
  const near = D_(0.09), on = D_(0.1);
  return near.text === '没变' && near.dir === 0 && on.text !== '没变' && on.dir === 1;
})());

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
