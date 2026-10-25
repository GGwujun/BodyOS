/**
 * M4.1 围度 冒烟测试(2026-10 扩:第六项体脂率、% 单位念法、按部位校验、曲线区间窗口)
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

/* ================= 六个部位 ================= */
ok('六个部位:腰胸臀臂腿+体脂率', G.SITES.map((s) => s.k).join(',') === 'waistCm,chestCm,hipCm,armCm,thighCm,bodyFatPct');
ok('每个部位都有量法提示', G.SITES.every((s) => s.hint.length > 4 && s.label.length >= 2));
ok('体脂率用 % 单位,五个围度用厘米', G.SITES.every((s) => s.unit === (s.k === 'bodyFatPct' ? '%' : 'cm')));
ok('体脂率客户端区间 3-60(比接口宽的 0-100 收得紧)', (() => {
  const bf = G.SITES.find((s) => s.k === 'bodyFatPct');
  return bf.min === 3 && bf.max === 60;
})());

/* ================= 序列 ================= */
const records = [
  rec('2026-09-01', { waistCm: 88, weightKg: 80, bodyFatPct: 22.5 }),
  rec('2026-10-01', { waistCm: 86.5, chestCm: 102 }),
  rec('2026-10-10', { waistCm: 85, bodyFatPct: 21.8 }),
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
ok('只列量过的部位(体脂率也算一项)', G.measuredSites(records).map((s) => s.k).join(',') === 'waistCm,chestCm,armCm,bodyFatPct');
ok('体脂率序列:中间断了也能取到上次', (() => {
  const bf = series.find((s) => s.k === 'bodyFatPct');
  return bf.latest === 21.8 && bf.prev === 22.5 && bf.first === 22.5 && bf.unit === '%';
})());
ok('序列点带完整日期(区间过滤靠它),不再截尾 30 个', (() => {
  const many = Array.from({ length: 40 }, (_, i) => rec(`2026-08-${String((i % 28) + 1).padStart(2, '0')}`, { waistCm: 90 }));
  const s = G.seriesOf(many).find((x) => x.k === 'waistCm');
  return s.points.length === 40 && s.points[0].date === '2026-08-01T08:00:00.000Z';
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
ok('体脂 +2.5% 念成百分点', G.deltaText(22.5, 25, '%').text === '+2.5%' && G.deltaText(22.5, 25, '%').dir === 1);
ok('体脂降 1.2 带负号', G.deltaText(24, 22.8, '%').text === '-1.2%');
ok('体脂不足 0.5pp 算没变(cm 的 0.2 阈值不套给体脂)', G.deltaText(22, 22.3, '%').text === '没变' && G.deltaText(22.4, 22.7, '%').text === '没变');
ok('体脂一次跳 6pp 提示换仪器而不是量错位置', /换了台仪器/.test(G.deltaText(20, 26, '%').text) && !/量错位置/.test(G.deltaText(20, 26, '%').text), G.deltaText(20, 26, '%').text);
ok('体脂跳 5pp 以内不提示', !/换了台仪器/.test(G.deltaText(20, 25, '%').text));

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

/* ================= 按部位校验输入 ================= */
{
  const bf = G.SITES.find((s) => s.k === 'bodyFatPct');
  const ws = G.SITES.find((s) => s.k === 'waistCm');
  ok('体脂 20.5% 正常收', G.parseGirth('20.5', bf) === 20.5);
  ok('体脂边界 3 / 60 放行', G.parseGirth('3', bf) === 3 && G.parseGirth('60', bf) === 60);
  ok('体脂 2.9 / 60.5 挡下', G.parseGirth('2.9', bf) === 'bad' && G.parseGirth('60.5', bf) === 'bad');
  ok('腰围按厘米区间:5 也挡、88 也收', G.parseGirth('5', ws) === 'bad' && G.parseGirth('88', ws) === 88);
  ok('不传部位时按厘米区间(老调用不破)', G.parseGirth('880') === 'bad' && G.parseGirth('85.46') === 85.5);
}

/* ================= 区间窗口(spanFilter) ================= */
{
  const pts = [
    { date: '2026-01-05T08:00:00.000Z', value: 90 },
    { date: '2026-09-20T08:00:00.000Z', value: 88 },
    { date: '2026-10-01T08:00:00.000Z', value: 87 },
    { date: '2026-10-22T08:00:00.000Z', value: 86 }
  ];
  const T = '2026-10-23';
  ok('all = 原样全量(且不动入参)', (() => {
    const out = G.spanFilter(pts, 'all', T);
    return out.length === 4 && out[0] === pts[0];
  })());
  ok('近 1 个月按日期位算(完整 ISO 也能喂)', G.spanFilter(pts, '30', T).map((p) => p.value).join(',') === '87,86');
  ok('近 3 个月', G.spanFilter(pts, '90', T).map((p) => p.value).join(',') === '88,87,86');
  ok('近 1 年把 1 月的也捞回来', G.spanFilter(pts, '365', T).length === 4);
  ok('窗口里一条没有 → 空数组(页面据此说「换长一点的区间」)', G.spanFilter(pts.slice(0, 1), '30', T).length === 0);
  ok('体重记录的纯日期串同样适用', G.spanFilter([{ date: '2026-10-01', v: 1 }, { date: '2026-05-01', v: 2 }], '90', '2026-10-23').length === 1);
  ok('BODY_SPANS 四档:1月/3月/1年/全部', G.BODY_SPANS.map((s) => s.k).join(',') === '30,90,365,all');
}

/* ================= 自建部位(extras) ================= */
{
  const prefs = { hidden: ['thighCm'], custom: [{ id: 'ab12cd', name: '左上臂' }] };
  const active = G.activeSites(prefs);
  ok('activeSites:藏了的内置不在,自建部位排在后面且是正经 Site(厘米区间)',
    active.map((s) => s.k).join(',') === 'waistCm,chestCm,hipCm,armCm,bodyFatPct,x-ab12cd'
    && active[5].label === '左上臂' && active[5].unit === 'cm' && active[5].min === 10 && active[5].max === 300,
    active.map((s) => s.k).join(','));

  const recs = [
    rec('2026-09-01', { waistCm: 88 }),
    rec('2026-10-01', { extras: { 'x-ab12cd': 35 } }),
    rec('2026-10-14', { extras: { 'x-ab12cd': 35.6 } })
  ];
  ok('valueOf:内置取自己的列、自建取 extras、没有的拿 null',
    G.valueOf(recs[0], 'waistCm') === 88 && G.valueOf(recs[1], 'x-ab12cd') === 35 && G.valueOf(recs[1], 'waistCm') === null);

  const avail = G.availableSites(prefs, recs);
  ok('availableSites = 显示中的 + 藏了但有数据的(大腿藏了且没量过 → 不在)',
    avail.map((s) => s.k).join(',') === 'waistCm,chestCm,hipCm,armCm,bodyFatPct,x-ab12cd',
    avail.map((s) => s.k).join(','));
  ok('藏了但量过数据的内置部位还在 available(藏不藏死历史)',
    G.availableSites({ hidden: ['thighCm'], custom: [] }, [rec('2026-10-01', { thighCm: 60 })])
      .some((s) => s.k === 'thighCm'));

  const arm = G.seriesOf(recs, avail).find((s) => s.k === 'x-ab12cd');
  ok('自建部位的序列照常出:最新/上次/第一次',
    arm.latest === 35.6 && arm.prev === 35 && arm.first === 35 && arm.points.length === 2);
  ok('measuredSites 只列量过的(自建部位也算一项)',
    G.measuredSites(recs, avail).map((s) => s.k).join(',') === 'waistCm,x-ab12cd');
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
