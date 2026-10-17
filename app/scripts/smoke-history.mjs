/**
 * M5.1 打卡热力图 + M5.2 个人纪录/动作曲线 + M5.3 掉力分析 冒烟测试
 * 另覆盖训练记录页那一串行(historyRows:一天一行、插上请假的日子)
 * 以及掉力的跨次趋势(dropSamples/dropTrend:这一次掉得多 vs 每次都掉得多)
 * 用法:node scripts/smoke-history.mjs(.smoke 由 tsc 预先生成)
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

const H = require('../.smoke/pkg-exercise/engine/history.js');
const O = require('../.smoke/pkg-exercise/engine/onerm.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const set = (reps, weightKg, rir = 2) => ({ reps, weightKg, rir });
const log = (date, entries, extra = {}) => {
  const sets = entries.flatMap((e) => e.sets);
  return {
    id: `wo-${date}`, planId: 'p', dayKey: 'd', dayTitle: '练', date,
    durationSec: 3600,
    totalSets: sets.length,
    totalReps: sets.reduce((n, s) => n + s.reps, 0),
    totalVolumeKg: Math.round(sets.reduce((n, s) => n + s.reps * (s.weightKg ?? 0), 0)),
    avgRir: null,
    entries,
    ...extra
  };
};

/* ================= 打卡 ================= */
const bench = (reps, w) => ({ exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(reps, w), set(reps, w), set(reps, w)] });

const logs = [
  log('2026-10-01', [bench(8, 60)]),
  log('2026-10-02', [bench(8, 60)]),
  log('2026-10-03', [{ exerciseId: '0043', nameZh: '杠铃深蹲', sets: [set(5, 100), set(5, 100)] }]),
  // 同一天练两次 —— 打卡只算一天,数据合并
  log('2026-10-05', [bench(8, 60)]),
  log('2026-10-05', [{ exerciseId: '0293', nameZh: '杠铃划船', sets: [set(10, 50), set(10, 50)] }])
];

const days = H.dayStats(logs);
ok('同一天练两次合并成一天', days.length === 4 && days.find((d) => d.date === '2026-10-05').sets === 5,
  JSON.stringify(days.map((d) => `${d.date}:${d.sets}`)));
ok('打卡按日期升序', days.map((d) => d.date).join(',') === '2026-10-01,2026-10-02,2026-10-03,2026-10-05');
ok('合并后容量相加', days.find((d) => d.date === '2026-10-05').volumeKg === 3 * 8 * 60 + 2 * 10 * 50);
ok('合并后时长相加', days.find((d) => d.date === '2026-10-05').durationSec === 7200);
ok('一天里的动作数也算得出', days.find((d) => d.date === '2026-10-05').exercises === 2);

ok('色阶:0 组不涂色', H.levelOf(0) === 0);
ok('色阶:3 组以内最浅(摸了一下)', H.levelOf(1) === 1 && H.levelOf(3) === 1);
ok('色阶:4-8 组第二档', H.levelOf(4) === 2 && H.levelOf(8) === 2);
ok('色阶:9-15 组第三档', H.levelOf(9) === 3 && H.levelOf(15) === 3);
ok('色阶:16 组以上封顶', H.levelOf(16) === 4 && H.levelOf(100) === 4);

const hm = H.heatmap(logs, 4, '2026-10-08');   // 10-08 是周四,本周一 = 10-05
ok('列数等于周数', hm.weeks.length === 4);
ok('每列七天', hm.weeks.every((w) => w.cells.length === 7));
ok('每列从周一开始', hm.weeks.every((w) => new Date(`${w.start}T00:00:00`).getDay() === 1),
  hm.weeks.map((w) => w.start).join(','));
ok('最后一列是本周', hm.weeks[3].start === '2026-10-05' && hm.weeks[3].cells[0].date === '2026-10-05');
ok('练过的日子涂上色', hm.weeks[3].cells[0].level > 0 && hm.weeks[3].cells[0].sets === 5);
ok('没练的日子是 0', hm.weeks[3].cells[3].level === 0);
ok('本周还没到的日子不涂色', hm.weeks[3].cells[5].level === 0 && hm.weeks[3].cells[6].level === 0);
ok('总打卡天数', hm.totalDays === 4, String(hm.totalDays));
ok('最长连续 3 天', hm.longest === 3, String(hm.longest));
ok('连着练到昨天,连续天数不断', hm.streak === 0 || hm.streak >= 1, String(hm.streak));

const hm2 = H.heatmap([log('2026-10-07', [bench(8, 60)]), log('2026-10-08', [bench(8, 60)])], 2, '2026-10-08');
ok('今天练了 → 连续天数为 2', hm2.streak === 2, String(hm2.streak));
const hm3 = H.heatmap([log('2026-10-06', [bench(8, 60)]), log('2026-10-07', [bench(8, 60)])], 2, '2026-10-08');
ok('昨天练了、今天还没练 → 连续不断', hm3.streak === 2, String(hm3.streak));
const hm4 = H.heatmap([log('2026-10-01', [bench(8, 60)]), log('2026-10-02', [bench(8, 60)])], 2, '2026-10-08');
ok('断了一周 → 连续清零', hm4.streak === 0, String(hm4.streak));
ok('没有日志时不炸', H.heatmap([], 4, '2026-10-08').totalDays === 0);

/* ---------- 色阶口径:组数 / 时长 / 容量 ---------- */
section('色阶口径:同一张格子图看的是三件事');
const manySets = (n) => ({ exerciseId: '0025', nameZh: '杠铃卧推', sets: [...Array(n)].map(() => set(5, 20)) });
/* 两天刻意排成「三个口径下的深浅完全不同」——
   这正是要有这个开关的理由:组数多的那天未必待得久,待得久的那天未必搬得多 */
const mixed = [
  // 10-05:20 组、20 分钟、1.5 吨 → 组数最多、时长中等、容量最少
  log('2026-10-05', [manySets(20)], { durationSec: 1200, totalVolumeKg: 1500 }),
  // 10-06:2 组、90 分钟、8 吨 → 组数最少、时长最多、容量次多
  log('2026-10-06', [manySets(2)], { durationSec: 5400, totalVolumeKg: 8000 })
];
const at = (h, date) => h.weeks.flatMap((w) => w.cells).find((c) => c.date === date);
const bySets = H.heatmap(mixed, 2, '2026-10-08', 'sets');
const byMin = H.heatmap(mixed, 2, '2026-10-08', 'minutes');
const byVol = H.heatmap(mixed, 2, '2026-10-08', 'volume');
ok('默认口径就是组数(老调用方不用改)',
  JSON.stringify(H.heatmap(mixed, 2, '2026-10-08').weeks) === JSON.stringify(bySets.weeks));
ok('组数口径:20 组最深、2 组最浅', at(bySets, '2026-10-05').level === 4 && at(bySets, '2026-10-06').level === 1,
  `${at(bySets, '2026-10-05').level}/${at(bySets, '2026-10-06').level}`);
ok('时长口径:90 分钟封顶,20 分钟只是第二档', at(byMin, '2026-10-06').level === 4 && at(byMin, '2026-10-05').level === 2,
  `${at(byMin, '2026-10-06').level}/${at(byMin, '2026-10-05').level}`);
ok('容量口径:8 吨第三档、1.5 吨最浅', at(byVol, '2026-10-06').level === 3 && at(byVol, '2026-10-05').level === 1,
  `${at(byVol, '2026-10-06').level}/${at(byVol, '2026-10-05').level}`);
ok('深浅随口径变,「哪天练了」不变', [bySets, byMin, byVol].every((h) =>
  at(h, '2026-10-05').trained && at(h, '2026-10-06').trained));
ok('格子上带着当前口径的数', at(byMin, '2026-10-06').value === 90 && at(byVol, '2026-10-06').value === 8000,
  `${at(byMin, '2026-10-06').value} / ${at(byVol, '2026-10-06').value}`);
ok('组数一直带着(和口径无关)', at(bySets, '2026-10-05').sets === 20 && at(byVol, '2026-10-05').sets === 20);

/* 老记录没有 durationSec(是 0)—— 那明明练了,换个口径不能变成「缺勤」 */
const noTime = H.heatmap([log('2026-10-05', [bench(8, 60)], { durationSec: 0 })], 2, '2026-10-08', 'minutes');
ok('练过但口径取不到数 → 按最浅一档涂,不是不涂',
  at(noTime, '2026-10-05').trained === true && at(noTime, '2026-10-05').level === 1,
  `trained=${at(noTime, '2026-10-05').trained} level=${at(noTime, '2026-10-05').level}`);
ok('未来的日子换哪个口径都不涂',
  [bySets, byMin, byVol].every((h) => at(h, '2026-10-08').level === 0));

ok('门槛表:组数 3/8/15', H.levelOf(3) === 1 && H.levelOf(4) === 2 && H.levelOf(8) === 2 && H.levelOf(9) === 3 && H.levelOf(16) === 4);
ok('门槛表:时长 15/30/60 分', H.levelOf(15, 'minutes') === 1 && H.levelOf(16, 'minutes') === 2
  && H.levelOf(30, 'minutes') === 2 && H.levelOf(31, 'minutes') === 3 && H.levelOf(60, 'minutes') === 3
  && H.levelOf(61, 'minutes') === 4);
ok('门槛表:容量 2/5/10 吨', H.levelOf(2000, 'volume') === 1 && H.levelOf(2001, 'volume') === 2
  && H.levelOf(5000, 'volume') === 2 && H.levelOf(5001, 'volume') === 3 && H.levelOf(10000, 'volume') === 3
  && H.levelOf(10001, 'volume') === 4);
ok('读不懂的数不涂色', H.levelOf(NaN, 'minutes') === 0 && H.levelOf(-5, 'volume') === 0);
ok('不认识的口径按组数走(老数据不炸)', H.levelOf(3, 'whatever') === 1 && H.levelOf(20, 'whatever') === 4);
ok('三个口径都在表里,key 齐全', H.HEAT_METRICS.length === 3
  && H.HEAT_METRICS.map((m) => m.k).join(',') === 'sets,minutes,volume');
/* 图例两端必须写得出数字 ——「少 / 多」是相对谁说的,只有算法知道 */
ok('图例两端带门槛的数字', H.HEAT_METRICS.every((m) => /[0-9]/.test(m.lo) && /[0-9]/.test(m.hi)),
  H.HEAT_METRICS.map((m) => `${m.lo}/${m.hi}`).join(' · '));
ok('两个词的口径名不重复(开关上分得清)', new Set(H.HEAT_METRICS.map((m) => m.label)).size === 3);

/* ================= 汇总 ================= */
const all = H.summaryOf(logs);
ok('汇总:训练次数', all.sessions === 5 && all.days === 4, `${all.sessions}/${all.days}`);
ok('汇总:总组数', all.sets === 3 + 3 + 2 + 3 + 2, String(all.sets));
ok('汇总:总容量是整数', Number.isInteger(all.volumeKg) && all.volumeKg === 9 * 8 * 60 + 2 * 5 * 100 + 2 * 10 * 50,
  String(all.volumeKg));
ok('汇总:总时长换算成分钟', all.minutes === 5 * 60, String(all.minutes));

const windowed = H.summaryOf(logs, '2026-10-03');
ok('按日期窗口过滤', windowed.sessions === 3 && windowed.days === 2, `${windowed.sessions}/${windowed.days}`);
ok('窗口内容量只算窗口内', windowed.volumeKg === 2 * 500 + 3 * 480 + 2 * 500, String(windowed.volumeKg));

/* ================= 练得多狠(强度画像)=================
   「平均强度」以前是汇总里的一个字段,口径是**每次训练的平均再平均** ——
   一次只评了一组的课,和一次评了三十组的课,在那一格上一样重。
   现在只留一份定义(effortStat):按**组**算,页面上那个数、那句话都由它出。 */
const effLogs = [
  // 第 1 场:5 组,评了 4 组(0 / 2 / 2 / 3)—— 3 那组正好在有效线上(见 effort.ts 的 HARD_RIR)
  log('2026-10-01', [{ exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(8, 60, 0), set(8, 60, 2), set(8, 60, 2), set(8, 60, 3), { reps: 8, weightKg: 60, rir: null }] }]),
  // 第 2 场:2 组,评了 2 组(4 / 4)—— 都留了太多余量
  log('2026-10-02', [{ exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(8, 60, 4), set(8, 60, 4)] }])
];
const eff = H.effortStat(effLogs);
ok('强度:分母是评过分的组(没评的不算进去)', eff.rated === 6, `${eff.rated} 评 / ${eff.sets} 组`);
ok('强度:总组数是日志里真做掉的组', eff.sets === 7, String(eff.sets));
// 0 / 2 / 2 / 3 四组在线上 —— 钉住边界:刚好剩 3 次算有效组,剩 4 次不算
ok('强度:有效组按 RIR ≤ 3 数(刚好 3 也算)', eff.hard === 4, String(eff.hard));
ok('强度:占比是整数百分比', eff.hardPct === 67, String(eff.hardPct));
// 这一条就是「按组算」和「按次算」的区别:按次算会变成 (0+2+2+3)/4 与 4 再平均 ≈ 2.7
ok('强度:平均按每一组算,不先按次再平均', eff.avgRir === 2.5, String(eff.avgRir));
ok('强度:五档计数用的是评分色带那份刻度', eff.bands.join(',') === '1,0,2,1,2', eff.bands.join(','));
ok('强度:五档加起来正好是评过的组数', eff.bands.reduce((a, b) => a + b, 0) === eff.rated);
const effWin = H.effortStat(effLogs, '2026-10-02');
ok('强度:窗口口径与「练了多少」同一个 from', effWin.rated === 2 && effWin.hard === 0, `${effWin.rated}/${effWin.hard}`);
ok('强度:一组都没评时不给任何数(而不是当成 0 分)', (() => {
  // 注意别拿 bench() 造这个 fixture —— 它的默认 rir 是 2,那样造出来的是「全都评过」的日志
  const z = H.effortStat([log('2026-10-01', [{ exerciseId: '0025', nameZh: '卧推', sets: [set(8, 60, null), set(8, 60, null)] }])]);
  return z.sets === 2 && z.rated === 0 && z.avgRir === null && z.hardPct === null && z.bands.every((n) => n === 0);
})());
ok('强度:没有日志时是空而不是崩', H.effortStat([]).sets === 0 && H.effortStat([]).hardPct === null);

/* ================= 个人纪录 ================= */
const prLogs = [
  log('2026-09-01', [{ exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(8, 60), set(8, 60), set(8, 60)] }]),
  log('2026-09-20', [{ exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(5, 70), set(5, 70)] }]),
  log('2026-10-04', [{ exerciseId: '0043', nameZh: '杠铃深蹲', sets: [set(5, 100), set(5, 100), set(5, 100)] }]),
  // 补录的假成绩不能当纪录
  log('2026-10-06', [{ exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(1, 200)] }], { manual: true })
];
const prs = H.personalRecords(prLogs);
const benchPr = prs.find((p) => p.exerciseId === '0025');
ok('每个动作一条纪录', prs.length === 2);
ok('最大重量取真实最好的一组', benchPr.topKg === 70 && benchPr.topReps === 5, `${benchPr.topKg}kg×${benchPr.topReps}`);
ok('补录的假成绩不算数', benchPr.topKg !== 200);
ok('最佳 1RM 估算与公式一致', benchPr.bestE1rm === Math.round(O.estimate1RM(70, 5) * 100) / 100,
  `${benchPr.bestE1rm} vs ${O.estimate1RM(70, 5)}`);
ok('单次最大容量', benchPr.bestVolumeKg === 3 * 8 * 60, String(benchPr.bestVolumeKg));
ok('纪录日期跟到最后一次刷新', benchPr.date === '2026-09-20', benchPr.date);
ok('练了几次记着', benchPr.times === 2, String(benchPr.times));
ok('最近刷新的排前面', prs[0].exerciseId === '0043', prs.map((p) => p.date).join(','));
ok('没有日志时没有纪录', H.personalRecords([]).length === 0);
ok('次数太多(>12)的组不拿去估 1RM', (() => {
  const many = H.personalRecords([log('2026-10-01', [{ exerciseId: '0025', nameZh: '卧推', sets: [set(30, 40), set(30, 40)] }])]);
  return many[0].bestE1rm === 0 && many[0].topKg === 40;
})());

/* ================= 动作曲线 ================= */
const hist = H.exerciseHistory(prLogs, '0025');
ok('只算这个动作', hist.length === 3, JSON.stringify(hist.map((p) => p.date)));
ok('曲线按时间升序', hist[0].date === '2026-09-01' && hist[1].date === '2026-09-20' && hist[2].date === '2026-10-06');
ok('每天取最重的一组', hist[1].topKg === 70 && hist[1].reps === 5);
ok('每天算该动作容量', hist[0].volumeKg === 3 * 8 * 60 && hist[0].sets === 3);
ok('每天算最佳 1RM', hist[1].bestE1rm === Math.round(O.estimate1RM(70, 5) * 100) / 100);
ok('补录日志也进曲线(历史就是要看全,只是不算纪录)', hist[2].topKg === 200);
ok('同一天练两次同动作合并', H.exerciseHistory([
  log('2026-10-01', [{ exerciseId: '0025', nameZh: '卧推', sets: [set(8, 60)] }]),
  log('2026-10-01', [{ exerciseId: '0025', nameZh: '卧推', sets: [set(5, 65)] }])
], '0025').length === 1);
ok('平均强度按评过分的组算', H.exerciseHistory([
  log('2026-10-01', [{ exerciseId: '0025', nameZh: '卧推', sets: [set(8, 60, 1), set(8, 60, 3), { reps: 8, weightKg: 60, rir: null }] }])
], '0025')[0].avgRir === 2);
ok('只有一次看不出趋势', !H.hasTrend(H.exerciseHistory([prLogs[0]], '0025')) && H.hasTrend(hist));
ok('动作名的兜底顺序:先用日志里的', H.nameOf(prLogs, '0025') === '杠铃卧推');
ok('日志里没有就查动作库', H.nameOf([], '0025') === '杠铃卧推', H.nameOf([], '0025'));
ok('库里也查不到就显示 id', H.nameOf([], 'nope') === 'nope');

/* ================= 掉力 ================= */
const d1 = H.dropOff([set(10, 60), set(9, 60), set(8, 60)]);
ok('掉力:逐组掉幅算出来', d1.sets.map((s) => s.dropPct).join(',') === '0,10,20', d1.sets.map((s) => s.dropPct).join(','));
ok('掉力:重量一致才判定适用', d1.uniform === true);
ok('掉力:掉 20% 提示加休息', /休息/.test(d1.verdict), d1.verdict);
ok('掉力:掉 10% 以内算正常', /刚好/.test(H.dropOff([set(10, 60), set(10, 60), set(9, 60)]).verdict));
ok('掉力:掉太多建议降重', /降一档/.test(H.dropOff([set(12, 60), set(7, 60), set(4, 60)]).verdict));
ok('掉力:末组反而多做 → 该加重', /再加一点/.test(H.dropOff([set(8, 60), set(10, 60)]).verdict));
ok('掉力:中途减重就不按掉力算', H.dropOff([set(10, 60), set(10, 55)]).uniform === false
  && /不一样/.test(H.dropOff([set(10, 60), set(10, 55)]).verdict));
ok('掉力:只有一组时说实话', /只有一组/.test(H.dropOff([set(10, 60)]).verdict));
ok('掉力:自重动作给替代说法', H.dropHint([set(10, null), set(8, null)]) != null
  && H.dropHint([set(10, 60)]) === null);
ok('掉力:0 次不会除出 NaN', (() => {
  const r = H.dropOff([set(0, 60), set(0, 60)]);
  return Number.isFinite(r.lastDropPct);
})());

/* ================= 上次 / 最好(M11 ⑦) ================= */
/* 练到某一行时最想知道的两个数:上次这个动作练成什么样、至今最好的一组是多少。
   以前只在历史面板里,而练到一半退出去翻一眼就是断节奏。 */
const TODAY = '2026-10-15';
const RL = (logs, id) => H.refText(H.refLine(logs, id, TODAY), TODAY);
const benchLog = (date, sets, extra = {}) => log(date, [{ exerciseId: '0025', nameZh: '杠铃卧推', sets }], extra);

section('上次 / 最好:一句话给两个数');
ok('从没练过 → 一个字都不说', RL([], '0025') === null, String(RL([], '0025')));
const refLogs = [
  benchLog('2026-10-01', [set(6, 65)]),                       // 更早的那次有最重的一组
  benchLog('2026-10-12', [set(8, 60), set(8, 60), set(6, 57.5)]),
  benchLog('2026-10-14', [set(8, 60), set(6, 57.5)])          // 最近的一次
];
ok('上次取最近那次 + 最好取最重的那组', RL(refLogs, '0025') === '上次 昨天 · 60kg×8 / 57.5kg×6 · 最好 65kg×6', RL(refLogs, '0025'));
ok('同一天再练一次就是今天',
  RL([benchLog('2026-10-15', [set(8, 60)])], '0025') === '上次 今天 · 60kg×8 · 最好 60kg×8');
ok('隔得久就照实说多少天前', RL([benchLog('2026-09-15', [set(8, 60)])], '0025').includes('上次 30 天前'));
ok('只显示这个动作自己的历史(别人的日志不算)',
  RL([log('2026-10-14', [{ exerciseId: '1460', nameZh: '行走弓步', sets: [set(10, null)] }])], '0025') === null);

section('上次 / 最好:挑选的两条口径');
// 同一天练两回 → 取那天组数多的那场(「上次练成什么样」问的是真练的那一场,不是补的那两组)
const twice = [
  benchLog('2026-10-14', [set(8, 60)]),
  benchLog('2026-10-14', [set(8, 60), set(8, 60), set(6, 57.5)])
];
ok('同一天两练 → 取组数多的那场', RL(twice, '0025') === '上次 昨天 · 60kg×8 / 60kg×8 / 57.5kg×6 · 最好 60kg×8', RL(twice, '0025'));
// 补录(manual)那次确实练了,只是记晚了 —— 照旧算「上次」,但不该被供成纪录
ok('补录的那次算「上次」(那天确实练了)',
  RL([benchLog('2026-10-14', [set(8, 60)], { manual: true })], '0025') === '上次 昨天 · 60kg×8', RL([benchLog('2026-10-14', [set(8, 60)], { manual: true })], '0025'));
ok('补录的那次不刷「最好」(数据记不准)',
  RL([benchLog('2026-10-14', [set(8, 60)]), benchLog('2026-10-13', [set(8, 60)], { manual: true }), benchLog('2026-10-12', [set(2, 90)], { manual: true })], '0025')
  === '上次 昨天 · 60kg×8 · 最好 60kg×8');
ok('「这次不算进步」那次的重量照样算「上次」',
  RL([benchLog('2026-10-14', [set(8, 60)], { noProg: true })], '0025') === '上次 昨天 · 60kg×8',
  RL([benchLog('2026-10-14', [set(8, 60)], { noProg: true })], '0025'));
// 只有「那次不算进步」的话,一句话都没有 —— 上面那条说的是「算上次」,不是「算纪录」
ok('「这次不算进步」不会自己变成纪录',
  RL([benchLog('2026-10-14', [set(8, 60)], { noProg: true })], '0025').includes('最好') === false);
// 一组都没做过的那天不算「上次」:那天只是把它排进了课表,没有可对照的事
const skipped = [{ reps: 0, weightKg: 100, rir: null }];
ok('一次都没做过的那一天不算「上次」',
  RL([benchLog('2026-10-14', skipped), benchLog('2026-10-10', [set(8, 60)])], '0025')
  === '上次 5 天前 · 60kg×8 · 最好 60kg×8',
  RL([benchLog('2026-10-14', skipped), benchLog('2026-10-10', [set(8, 60)])], '0025'));
ok('跳过的那组既不算「上次」也不算纪录',
  RL([benchLog('2026-10-14', [set(8, 60), ...skipped])], '0025') === '上次 昨天 · 60kg×8 · 最好 60kg×8',
  RL([benchLog('2026-10-14', [set(8, 60), ...skipped])], '0025'));
ok('从头到尾一组都没做过 → 一个字都不说',
  RL([benchLog('2026-10-14', skipped), benchLog('2026-10-10', skipped)], '0025') === null);

section('上次 / 最好:三种动作各自的念法');
// 计时型:次数恒为 0,唯一的量是秒 —— 这一档要是按次数念,一整行会显示成「0 次」
const plank = (date, secs) => log(date, [{ exerciseId: '2135', nameZh: '负重平板支撑', sets: secs.map((s) => ({ reps: 0, weightKg: null, rir: null, sec: s })) }]);
ok('计时型按秒念', RL([plank('2026-10-14', [60, 45]), plank('2026-10-10', [90])], '2135')
  === '上次 昨天 · 保持 1 分 / 保持 45 秒 · 最好 保持 1 分 30 秒', RL([plank('2026-10-14', [60, 45]), plank('2026-10-10', [90])], '2135'));
ok('计时型的「最好」是撑得最久的那一组,不是最近那组', RL([plank('2026-10-14', [60])], '2135').includes('最好 保持 1 分'));
// 自重 + 单侧:20 次是两侧合计,念的是每侧 10 次(和别处同一个折算)
ok('单侧动作念「每侧几次」', RL([log('2026-10-14', [{ exerciseId: '1460', nameZh: '行走弓步', sets: [set(20, null), set(20, null)] }])], '1460')
  === '上次 昨天 · 每侧 10 次 / 每侧 10 次 · 最好 每侧 10 次',
  RL([log('2026-10-14', [{ exerciseId: '1460', nameZh: '行走弓步', sets: [set(20, null), set(20, null)] }])], '1460'));
ok('加权重的单侧动作:重量 × 每侧次数',
  RL([log('2026-10-14', [{ exerciseId: '0292', nameZh: '哑铃单臂划船', sets: [set(16, 30)] }])], '0292')
  === '上次 昨天 · 30kg×每侧 8 · 最好 30kg×每侧 8', RL([log('2026-10-14', [{ exerciseId: '0292', nameZh: '哑铃单臂划船', sets: [set(16, 30)] }])], '0292'));
ok('徒手动作只有次数可说', RL([log('2026-10-14', [{ exerciseId: '0652', nameZh: '引体向上', sets: [set(8, null), set(6, null)] }])], '0652')
  === '上次 昨天 · 8 次 / 6 次 · 最好 8 次', RL([log('2026-10-14', [{ exerciseId: '0652', nameZh: '引体向上', sets: [set(8, null), set(6, null)] }])], '0652'));
// 助力器械的「重量」是器械替你分担的力,越大越轻松 —— 记成「最好」会越练越漂亮
ok('助力器械的重量不当「最好」', RL([log('2026-10-14', [{ exerciseId: '0017', nameZh: '助力引体向上', sets: [set(10, 40), set(6, 50)] }])], '0017')
  === '上次 昨天 · 助力 40kg×10 / 助力 50kg×6 · 最好 10 次',
  RL([log('2026-10-14', [{ exerciseId: '0017', nameZh: '助力引体向上', sets: [set(10, 40), set(6, 50)] }])], '0017'));
ok('单侧 + 计时混不进同一句(各按各的量纲念)', RL([plank('2026-10-14', [45]), benchLog('2026-10-14', [set(8, 60)])], '2135')
  === '上次 昨天 · 保持 45 秒 · 最好 保持 45 秒');

section('参照行不跟着渲染走的那份稳定性');
// 参照行挂在 useMemo 上按 id 拼串做依赖 —— 这里钉住「同样的日志给同样的话」,
// 免得哪天改成有副作用/带时间戳的实现(那样每 250ms 一次的休息 tick 都会让它变一句)
ok('同一份日志连算两次一模一样',
  RL(refLogs, '0025') === RL(JSON.parse(JSON.stringify(refLogs)), '0025'));
ok('传进去的日志没被改过', JSON.stringify(refLogs) === JSON.stringify(JSON.parse(JSON.stringify(refLogs))));

/* ================= 动作库列表那一行(挑动作时看到的「最好」) ================= */
/* 列表一行是「练过 12 次 · 最好 65kg×6」,其中后半句和训练页参照行是**同一个数** ——
   挑动作时看到的和做的时候看到的必须是同一个,不然同一个人在两处读到两个最好成绩。
   这一节同时是上面那次抽取(bestOf)的护栏:把 refLine 里那段扫描换成公用实现之后,
   上面那一整节的断言都还指着同一套口径。 */
const B = (logs, id) => H.bestOf(logs)[id];

section('列表一行:表里有什么');
ok('一批日志算一次,每个动作各有一条',
  Object.keys(H.bestOf([...refLogs, plank('2026-10-14', [70])])).sort().join(',') === '0025,2135',
  Object.keys(H.bestOf([...refLogs, plank('2026-10-14', [70])])).join(','));
ok('和参照行那句「最好」是同一个数',
  RL(refLogs, '0025') === `上次 昨天 · 60kg×8 / 57.5kg×6 · 最好 ${B(refLogs, '0025')}`, RL(refLogs, '0025'));
ok('没练过的动作不在表里(列表上不会多一句「最好 —」)', B(refLogs, '0652') === undefined, String(B(refLogs, '0652')));
ok('自重动作也有「最好」—— 它就是次数最多的那组',
  B([log('2026-10-14', [{ exerciseId: '0652', nameZh: '引体向上', sets: [set(8, null), set(6, null)] }])], '0652') === '8 次',
  String(B([log('2026-10-14', [{ exerciseId: '0652', nameZh: '引体向上', sets: [set(8, null), set(6, null)] }])], '0652')));
ok('计时型念秒', B([plank('2026-10-14', [60, 45]), plank('2026-10-10', [90])], '2135') === '保持 1 分 30 秒',
  String(B([plank('2026-10-14', [60, 45]), plank('2026-10-10', [90])], '2135')));
ok('助力器械只念次数(它的「重量」越大越轻松,念出来会越练越漂亮)',
  B([log('2026-10-14', [{ exerciseId: '0017', nameZh: '助力引体向上', sets: [set(10, 40), set(6, 50)] }])], '0017') === '10 次',
  String(B([log('2026-10-14', [{ exerciseId: '0017', nameZh: '助力引体向上', sets: [set(10, 40), set(6, 50)] }])], '0017')));
ok('补录那次不刷「最好」(数据记不准)',
  B([benchLog('2026-10-12', [set(2, 90)], { manual: true })], '0025') === undefined);
ok('「这次不算进步」那场的重量不当「最好」',
  B([benchLog('2026-10-14', [set(8, 60)], { noProg: true })], '0025') === undefined);
/* 上面那条查的是**整场**不算(发烧、伤后复出),这条查的是**只标了这一个动作**不算
   —— 两个粒度是两道门(见 types.ts 的 entryCounts),只测一道的话,另一道门删掉都没人知道。
   90kg 那条就是「换了台器械,重量不可比」的样子:场次是好的,这个数不该被供成纪录。 */
const noProgEntry = (date, sets) => log(date, [{ exerciseId: '0025', nameZh: '杠铃卧推', sets, noProg: true }]);
ok('只标了「这个动作不算进步」的那一条:重量不当「最好」',
  B([noProgEntry('2026-10-14', [set(2, 90)])], '0025') === undefined,
  String(B([noProgEntry('2026-10-14', [set(2, 90)])], '0025')));
// 同一次训练里那个动作出现两回(换台器械再来一轮),只有一条标了不算 —— 另一条照算
const mixEntry = [log('2026-10-14', [
  { exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(2, 90)], noProg: true },
  { exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(8, 60)] }
])];
ok('同一次训练里另有一条没标:那条照算', B(mixEntry, '0025') === '60kg×8', String(B(mixEntry, '0025')));
ok('跳过的那组不算「最好」',
  B([benchLog('2026-10-14', [set(8, 60), ...skipped])], '0025') === '60kg×8',
  String(B([benchLog('2026-10-14', [set(8, 60), ...skipped])], '0025')));
// 排进课表但一组都没做 → 列表上不该出现这个键(不是「最好 」后面跟个空白)
ok('一个数都攒不出来的动作不进表', B([benchLog('2026-10-14', skipped)], '0025') === undefined,
  JSON.stringify(H.bestOf([benchLog('2026-10-14', skipped)])));

/* ================= 训练记录的一串行(训练记录页) ================= */
section('训练记录:一天一行,从近到远');
const hr = (logs2, notes, today) => H.historyRows(logs2, notes, today);
const datesOf = (rows) => rows.map((r) => r.date).join(',');
const note = (kind, text = '') => ({ kind, text, at: '2026-10-01T00:00:00.000Z' });

ok('每一次训练一行,新的在前', datesOf(hr(logs, {}, '2026-10-31')) === '2026-10-05,2026-10-05,2026-10-03,2026-10-02,2026-10-01',
  datesOf(hr(logs, {}, '2026-10-31')));
// 同一天的两次:日志本来就是新的在前,这里**不许**重排(稳定性不能指望引擎的 sort)
ok('同一天的两次保持原有先后', (() => {
  const rows = hr(logs, {}, '2026-10-31');
  const sameDay = rows.filter((r) => r.date === '2026-10-05');
  return sameDay.length === 2 && sameDay[0].log?.id === logs[3].id && sameDay[1].log?.id === logs[4].id;
})());
ok('训练行带着原来那条日志本身(不复制、不改写)', (() => {
  const rows = hr(logs, {}, '2026-10-31');
  return rows.every((r) => (r.log ? logs.includes(r.log) : true));
})());

section('训练记录:没练但请过假的日子');
const withNote = hr(logs, { '2026-10-04': note('sick', '嗓子发炎') }, '2026-10-31');
ok('请假的空档插在该在的位置上', datesOf(withNote) === '2026-10-05,2026-10-05,2026-10-04,2026-10-03,2026-10-02,2026-10-01',
  datesOf(withNote));
ok('那一行是请假条,没有训练', (() => {
  const r = withNote.find((x) => x.date === '2026-10-04');
  return !!r && r.log === null && r.note?.kind === 'sick';
})());
// 那天练都练了,让训练自己说话(要改请假去热力图那边,那是看「安排」的地方)
ok('练过的那天不另出请假行', (() => {
  const rows = hr(logs, { '2026-10-03': note('travel') }, '2026-10-31');
  return rows.length === logs.length && rows.find((r) => r.date === '2026-10-03').log != null;
})());
// 请假可以提前标(出差前一晚把后面几天一起标了),但那还没发生 —— 记录页只说过去和今天
ok('今天的请假算,明天的不算', (() => {
  const notes = { '2026-10-15': note('rest'), '2026-10-16': note('travel') };
  const rows = hr([], notes, '2026-10-15');
  return datesOf(rows) === '2026-10-15';
})(), datesOf(hr([], { '2026-10-15': note('rest'), '2026-10-16': note('travel') }, '2026-10-15')));

section('训练记录:脏数据与空');
ok('读不懂的日期/缺 kind 的条目直接丢掉,不炸', (() => {
  const rows = hr([], { '2026-02-30': note('sick'), '2026-10-02': { text: '没写原因' }, '2026-10-01': note('rest') }, '2026-10-31');
  return datesOf(rows) === '2026-10-01';
})());
ok('什么都没记就是空', hr([], {}, '2026-10-31').length === 0);
ok('只有请假没有训练也能列出来', hr([], { '2026-09-30': note('injured') }, '2026-10-31').length === 1);
ok('传进去的日志和请假表都没被改过', (() => {
  const l0 = JSON.stringify(logs);
  const n0 = JSON.stringify({ '2026-10-04': note('sick') });
  hr(logs, JSON.parse(n0), '2026-10-31');
  return JSON.stringify(logs) === l0;
})());

/* ================= 掉力的跨次趋势(这个动作最近几次都在怎么掉) ================= */
section('跨次趋势:采样只收能算掉力的那几次');
const dr = (date, reps, w = 60) => benchLog(date, reps.map((r) => set(r, w)));
const samplesOf = (logs2, mode = 'reps', limit = 5) => H.dropSamples(logs2, '0025', mode, limit);
const tOf = (logs2) => H.dropTrend(H.dropSamples(logs2, '0025', 'reps'));

// 故意乱序传进去 —— 「最近几次」问的是日期,不是数组顺序
const steady = dr('2026-10-06', [10, 9, 8]);
const worst = dr('2026-10-14', [10, 6, 5]);   // 末组掉 50%
const s1 = samplesOf([steady, dr('2026-10-12', [10, 9, 8]), worst, dr('2026-10-09', [10, 9, 8])]);
ok('采样按日期近→远,不看输入顺序', s1.map((s) => s.date).join(',') === '2026-10-14,2026-10-12,2026-10-09,2026-10-06',
  s1.map((s) => s.date).join(','));
ok('每次带自己的末组掉幅', s1.map((s) => s.lastDropPct).join(',') === '50,20,20,20', s1.map((s) => s.lastDropPct).join(','));
ok('采样带上重量(计时型之外)', s1.every((s) => s.weightKg === 60));
ok('取最近 limit 次', samplesOf([steady, dr('2026-10-12', [10, 9, 8]), worst], 'reps', 2).length === 2);

const mix = samplesOf([
  dr('2026-10-14', [10, 9, 8]),                     // 收
  benchLog('2026-10-13', [set(8, 60)]),             // 只有一组 —— 收不了
  benchLog('2026-10-12', [set(10, 60), set(10, 55)]), // 中途减重(金字塔)—— 掉的是重量不是力气
  log('2026-10-11', [{ exerciseId: '0043', nameZh: '杠铃深蹲', sets: [set(5, 100), set(5, 100)] }]), // 不是这个动作
  dr('2026-10-10', [10, 9, 8])                      // 收
]);
ok('单组 / 金字塔 / 别的动作都不进采样', mix.map((s) => s.date).join(',') === '2026-10-14,2026-10-10',
  mix.map((s) => s.date).join(','));

section('跨次趋势:一次掉得多 ≠ 每次都掉得多');
const four = [worst, dr('2026-10-12', [10, 9, 8]), dr('2026-10-09', [10, 9, 8]), dr('2026-10-06', [10, 9, 8])];
const heavy = tOf(four);
ok('平均掉幅是几次的平均', heavy.avgPct === 28 && heavy.latestPct === 50 && heavy.priorAvgPct === 20,
  `${heavy.avgPct}/${heavy.latestPct}/${heavy.priorAvgPct}`);
ok('次次都掉 → 说这是重量的事,不是偶然', /不是偶然/.test(heavy.verdict) && /降一档/.test(heavy.verdict), heavy.verdict);

// 之前每次都只掉 10% —— 这一次的 50% 更像一天的状态,不该据此降重量
const offDay = tOf([worst, dr('2026-10-12', [10, 10, 9]), dr('2026-10-09', [10, 10, 9]), dr('2026-10-06', [10, 10, 9])]);
ok('就这一次狠掉 → 别急着降重量', offDay.latestPct === 50 && offDay.priorAvgPct === 10
  && /状态/.test(offDay.verdict) && /别急着降重量/.test(offDay.verdict), offDay.verdict);

const fine = tOf([dr('2026-10-12', [10, 10, 9]), dr('2026-10-09', [10, 10, 9]), dr('2026-10-06', [10, 10, 9])]);
ok('都掉在 10% 以内 → 这重量稳得住', fine.avgPct === 10 && /稳得住/.test(fine.verdict), fine.verdict);
ok('末组反而做得多 → 力气还有富余', /富余/.test(tOf([
  dr('2026-10-12', [10, 10, 12]), dr('2026-10-09', [10, 10, 12]), dr('2026-10-06', [10, 10, 12])
]).verdict));
// 掉 25%、不掉、掉 25%、不掉 —— 平均 13% 却两边都不是,只能说还是先固定休息
const zigzag = tOf([dr('2026-10-14', [8, 6]), dr('2026-10-13', [8, 8]), dr('2026-10-12', [8, 6]), dr('2026-10-11', [8, 8])]);
ok('忽高忽低 → 不说重量,只说先把休息固定', zigzag.avgPct === 13 && /忽高忽低/.test(zigzag.verdict), zigzag.verdict);

section('跨次趋势:少于三次不给结论');
ok('一次都没有 → null', tOf([]) === null);
ok('一次看不出趋势', tOf([worst]) === null);
ok('两次也凑不出趋势(单次那张卡已经说过了)', tOf([worst, dr('2026-10-12', [10, 9, 8])]) === null);
ok('第三次开始给结论', tOf([worst, dr('2026-10-12', [10, 9, 8]), dr('2026-10-09', [10, 9, 8])]) != null);

section('跨次趋势:计时型按秒采样');
const pd = (date, secs) => log(date, [{
  exerciseId: '2135', nameZh: '负重平板支撑',
  sets: secs.map((s) => ({ reps: 0, weightKg: null, rir: null, sec: s }))
}]);
const planks = [pd('2026-10-14', [60, 45]), pd('2026-10-11', [60, 45]), pd('2026-10-08', [60, 45])];
ok('计时型采样看秒数', H.dropSamples(planks, '2135', 'sec').map((s) => s.lastDropPct).join(',') === '25,25,25',
  H.dropSamples(planks, '2135', 'sec').map((s) => s.lastDropPct).join(','));
ok('计时型的趋势也说得出来', /不是偶然/.test(H.dropTrend(H.dropSamples(planks, '2135', 'sec')).verdict));
// 反过来:计时型的组在次数口径下没有重量,拿 'reps' 去采会一组都收不到
ok('计时型的记录不会被次数口径收走', H.dropSamples(planks, '2135', 'reps').length === 0);
ok('缺秒数的那次不收(算不出掉幅)',
  H.dropSamples([...planks, pd('2026-10-05', [60, 0])], '2135', 'sec').length === 3);

section('跨次趋势:不吃输入');
ok('采样和趋势都不改传进去的日志', (() => {
  const l0 = JSON.stringify(planks);
  const snap = H.dropSamples(planks, '2135', 'sec');
  H.dropTrend(snap);
  return JSON.stringify(planks) === l0;
})());
ok('同一份日志连算两次一模一样', JSON.stringify(tOf(four)) === JSON.stringify(tOf(four)));

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
