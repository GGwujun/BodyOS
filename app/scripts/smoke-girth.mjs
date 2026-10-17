/**
 * M4.1 围度 冒烟测试
 * 准备:
 *   npx tsc -p <临时 tsconfig(带 @/* paths 映射,baseUrl=app/src)> --outDir .smoke
 * 用法:node scripts/smoke-girth.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const G = require('../.smoke/utils/girth.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

const rec = (date, g) => ({ id: `m-${date}`, measuredAt: `${date}T08:00:00.000Z`, ...g });

/* ================= 五个部位 ================= */
ok('五个部位:腰胸臀臂腿', G.SITES.map((s) => s.k).join(',') === 'waistCm,chestCm,hipCm,armCm,thighCm');
ok('每个部位都有量法提示', G.SITES.every((s) => s.hint.length > 4 && s.label.length >= 2));

/* ================= 序列 ================= */
const records = [
  rec('2026-09-01', { waistCm: 88, weightKg: 80 }),
  rec('2026-10-01', { waistCm: 86.5, chestCm: 102 }),
  rec('2026-10-10', { waistCm: 85 }),
  rec('2026-10-14', { chestCm: 103, armCm: 37 })
];
const series = G.seriesOf(records);
const waist = series.find((s) => s.k === 'waistCm');
ok('一次没量到的部位不会被当成 0', waist.latest === 85 && waist.points.length === 3, JSON.stringify(waist.points));
ok('序列按时间升序', waist.points.map((p) => p.value).join(',') === '88,86.5,85');
ok('上次的值取「上一次量到的」而非上一条记录', waist.prev === 86.5, String(waist.prev));
ok('第一次的值取全量首条', waist.first === 88);
ok('只有一次的部位 prev 为 null', series.find((s) => s.k === 'armCm').prev === null);
ok('没量过的部位 latest 为 null', series.find((s) => s.k === 'thighCm').latest === null);
ok('只列量过的部位', G.measuredSites(records).map((s) => s.k).join(',') === 'waistCm,chestCm,armCm');
ok('画图点最多 30 个', (() => {
  const many = Array.from({ length: 40 }, (_, i) => rec(`2026-08-${String((i % 28) + 1).padStart(2, '0')}`, { waistCm: 90 }));
  return G.seriesOf(many).find((s) => s.k === 'waistCm').points.length === 30;
})());
ok('乱序输入也能排好', G.seriesOf([records[2], records[0], records[3], records[1]])
  .find((s) => s.k === 'waistCm').latest === 85);

/* ================= 变化量 ================= */
ok('变化 1.4cm 正常念出来', G.deltaText(85, 86.4).text === '+1.4 cm' && G.deltaText(85, 86.4).dir === 1);
ok('减下来带负号', G.deltaText(88, 85.5).text === '-2.5 cm' && G.deltaText(88, 85.5).dir === -1);
ok('不足 0.2cm 算没变', G.deltaText(85, 85.1).text === '没变' && G.deltaText(85, 85.1).dir === 0);
ok('同一位置量两次不会报差异', G.deltaText(85, 85).text === '没变');
ok('一次差 8cm 提示量错位置', /量错位置/.test(G.deltaText(80, 88.2).text), G.deltaText(80, 88.2).text);
ok('差 5cm 以内不提示', !/量错位置/.test(G.deltaText(80, 85).text));

/* ================= 腰臀比 ================= */
const whrRecs = [
  rec('2026-09-01', { waistCm: 88, hipCm: 100 }),
  rec('2026-10-01', { waistCm: 86, hipCm: 100 })
];
ok('腰臀比取最近一次同时有腰和臀的记录', (() => {
  const w = G.whrOf(whrRecs);
  return w.value === 0.86 && w.date.slice(0, 10) === '2026-10-01';
})(), JSON.stringify(G.whrOf(whrRecs)));
ok('腰臀比 0.86 → 中间档', G.whrOf(whrRecs).tone === 'mid');
ok('腰围 82 臀围 100 → 0.82 正常档', G.whrOf([rec('2026-10-01', { waistCm: 82, hipCm: 100 })]).tone === 'ok');
ok('腰围 95 臀围 100 → 0.95 偏高', G.whrOf([rec('2026-10-01', { waistCm: 95, hipCm: 100 })]).tone === 'high');
ok('只有腰围没有臀围 → 算不出', G.whrOf([rec('2026-10-01', { waistCm: 80 })]) === null);
ok('缺了最近一次的臀围就往前找', (() => {
  const w = G.whrOf([rec('2026-09-01', { waistCm: 88, hipCm: 100 }), rec('2026-10-14', { waistCm: 84 })]);
  return w != null && w.date.slice(0, 10) === '2026-09-01';
})());
ok('臀围为 0 不会算出无穷大', G.whrOf([rec('2026-10-01', { waistCm: 80, hipCm: 0 })]) === null);
ok('没有记录时返回 null', G.whrOf([]) === null);

/* ================= 输入解析 ================= */
ok('空串 = 这次没量', G.parseGirth('') === null && G.parseGirth('  ') === null);
ok('正常数值保留一位小数', G.parseGirth('85.46') === 85.5);
ok('整数字符串也认', G.parseGirth('88') === 88);
ok('超范围判为不对', G.parseGirth('880') === 'bad' && G.parseGirth('5') === 'bad');
ok('非数字判为不对', G.parseGirth('abc') === 'bad' && G.parseGirth('-80') === 'bad');
ok('边界值放行', G.parseGirth('10') === 10 && G.parseGirth('300') === 300);
ok('刚好越界被挡', G.parseGirth('9.9') === 'bad' && G.parseGirth('300.1') === 'bad');
ok('浮点噪声不会变成奇怪的小数', G.parseGirth('85.10000000000001') === 85.1, String(G.parseGirth('85.10000000000001')));

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
