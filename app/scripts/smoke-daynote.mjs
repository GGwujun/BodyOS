/**
 * M10.1 请假条 冒烟测试 —— 日期校验、脏数据清洗、以及**欠账/提醒怎么被它影响**
 * (后半段是重点:请假这个功能本身没什么逻辑,价值全在「提醒因此闭嘴」上)。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-daynote.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** 假 storage:请假是「写进去还得读得回来」的东西,只测返回值不算数 */
const store = new Map();
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    // default 那一份不能省:编译产物是 __importDefault(require(...)),取不到就
    // 报「storage 用不了」而不是这里 —— 那个错会把人带到完全无关的地方
    const storage = {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => store.set(k, v),
      removeStorageSync: (k) => store.delete(k)
    };
    return { default: storage, ...storage };
  }
  return origLoad.call(this, req, ...rest);
};

const D = require('../.smoke/pkg-exercise/engine/daynote.js');
const Schedule = require('../.smoke/pkg-exercise/engine/schedule.js');
const Nudge = require('../.smoke/pkg-exercise/engine/nudge.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/* ===== 和 smoke-nudge 同一套造数工具(两处必须同源,否则结论对不上) ===== */
const plan = (keys, daysPerWeek = 3) => ({
  id: 'p1', createdAt: '2026-09-01T00:00:00.000Z', goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek, sessionMin: 45, doneCount: 0, lastNote: '',
  days: keys.map((k, i) => ({ key: k, title: `第 ${i + 1} 天 · ${k}`, focus: '', estMin: 45, items: [] }))
});
const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const log = (date, dayKey = 'a') => ({ id: `${dayKey}-${date}`, planId: 'p1', dayKey, dayTitle: '', date });
const logsOf = (dates, dayKey = 'a') => dates.map((d) => log(d, dayKey));
/** 每隔 n 天练一次,最后一次是 end(含),共 count 次 → 用户节奏 = n */
const everyN = (n, count, end) => {
  const out = [];
  const d = new Date(`${end}T00:00:00`);
  for (let i = 0; i < count; i++) { out.unshift(iso(d)); d.setDate(d.getDate() - n); }
  return out;
};
/** 从 ['10-14','10-15'] 这样的简写造请假表(测试里少打点字) */
const notes = (...days) => {
  const out = {};
  for (const d of days) out[`2026-${d}`] = { kind: 'sick', text: '', at: '' };
  return out;
};

const TODAY = '2026-10-15';
const P3 = plan(['a', 'b', 'c'], 3);

/* ===================== 纯逻辑 ===================== */

section('日期必须是真日子');
ok('正常日期认', D.isIsoDate('2026-10-15') && D.isIsoDate('2025-01-01'));
ok('必须补零(2 月 5 日要写 02-05)', !D.isIsoDate('2026-2-5'));
ok('2 月 30 日不是日子', !D.isIsoDate('2026-02-30'), 'new Date 会把它滚到 3 月,只有跟原文比对才认得出');
ok('13 月不是月份', !D.isIsoDate('2026-13-01'));
ok('别的东西不认', !D.isIsoDate('今天') && !D.isIsoDate('') && !D.isIsoDate(null) && !D.isIsoDate(20261015));

section('请假原因');
ok('四种都认', D.NOTE_KINDS.every((k) => D.kindOf(k) === k));
ok('大小写不算(存的是规范值,不是用户输入)', D.kindOf('SICK') === null);
ok('中文原因不认(它只该从选择器里来)', D.kindOf('感冒') === null);
ok('空的/别的类型不认', D.kindOf('') === null && D.kindOf(null) === null && D.kindOf(1) === null);
ok('生病排在最前(点开先看到的是真没办法的那个)', D.NOTE_KINDS[0] === 'sick');

section('补充说明');
ok('首尾空格去掉', D.cleanText('  低烧  ') === '低烧');
ok('换行压成空格(单行 Text 里换行会显示成奇怪的空白)', D.cleanText('低烧\n睡了一天') === '低烧 睡了一天');
ok('超长截断', D.cleanText('啊'.repeat(80)).length === D.NOTE_TEXT_MAX);
ok('不是字符串就当没有', D.cleanText(null) === '' && D.cleanText(42) === '');

section('清洗:读不懂的条目宁可丢掉,也不能猜');
ok('整份不是对象 → 空表', Object.keys(D.sanitizeDayNotes(null)).length === 0
  && Object.keys(D.sanitizeDayNotes([])).length === 0
  && Object.keys(D.sanitizeDayNotes('x')).length === 0);
ok('日期不是真日子 → 丢', Object.keys(D.sanitizeDayNotes({ '2026-02-30': { kind: 'sick' } })).length === 0);
ok('原因不认识 → 丢(猜一个的话用户会莫名收不到提醒)', Object.keys(D.sanitizeDayNotes({ '2026-10-15': { kind: '感冒' } })).length === 0);
ok('值不是对象 → 丢', Object.keys(D.sanitizeDayNotes({ '2026-10-15': 'sick' })).length === 0);
ok('好的留下,顺手把说明洗干净', (() => {
  const n = D.sanitizeDayNotes({ '2026-10-15': { kind: 'sick', text: ' 低烧 ', at: 'x' } });
  return n['2026-10-15'].kind === 'sick' && n['2026-10-15'].text === '低烧' && n['2026-10-15'].at === 'x';
})());
ok('at 不是字符串就给空串,不留 undefined', (() => {
  const n = D.sanitizeDayNotes({ '2026-10-15': { kind: 'rest' } });
  return n['2026-10-15'].at === '';
})());

section('能记哪几天');
ok('今天能记', D.noteBlockedBy(TODAY, TODAY) === '');
ok('能提前 30 天(出差前一晚把接下来几天一起标了)', D.noteBlockedBy('2026-11-14', TODAY) === '');
ok('提前 31 天就不让了', D.noteBlockedBy('2026-11-15', TODAY) !== '');
ok('能往前补记一年(热力图上补花)', D.noteBlockedBy('2025-10-15', TODAY) === '');
ok('再往前就不让了(记了也没有意义)', D.noteBlockedBy('2025-10-14', TODAY) !== '');
ok('日期本身不对 → 不让', D.noteBlockedBy('乱写', TODAY) !== '');

section('半开区间:起算那天不算、截止那天算');
const edge = { '2026-10-10': { kind: 'sick', text: '', at: '' }, '2026-10-11': { kind: 'sick', text: '', at: '' },
  '2026-10-15': { kind: 'sick', text: '', at: '' }, '2026-10-16': { kind: 'sick', text: '', at: '' } };
ok('(10-10, 10-15] 里请假 2 天', D.excusedBetween(edge, '2026-10-10', '2026-10-15') === 2,
  String(D.excusedBetween(edge, '2026-10-10', '2026-10-15')));
ok('起算那天请的假不算(那天是训练日,练都练了)', D.excusedBetween(edge, '2026-10-09', '2026-10-15') === 3);
ok('空区间 / 反过来的区间都是 0', D.excusedBetween(edge, '2026-10-15', '2026-10-15') === 0
  && D.excusedBetween(edge, '2026-10-16', '2026-10-10') === 0);
ok('不是真日期 → 0(不抛异常)', D.excusedBetween(edge, '乱写', TODAY) === 0);

section('连着请到今天是第几天');
const run = notes('10-13', '10-14', '10-15');
ok('连着三天', D.excusedRunLen(run, '2026-10-15') === 3);
ok('从中间看是两天', D.excusedRunLen(run, '2026-10-14') === 2);
ok('没请就是 0', D.excusedRunLen(run, '2026-10-12') === 0);
ok('断了重新数', D.excusedRunLen(notes('10-12', '10-15'), '2026-10-15') === 1);

section('卡片上那句话');
ok('只说原因', D.noteText({ kind: 'sick', text: '', at: '' }) === '生病');
ok('带说明', D.noteText({ kind: 'travel', text: '去广州', at: '' }) === '出差 / 旅行 · 去广州');

section('列表:从近到远');
ok('按日期倒序,超出上限截断', (() => {
  const l = D.noteList(notes('10-01', '10-15', '10-10'), 2);
  return l.length === 2 && l[0].date === '2026-10-15' && l[1].date === '2026-10-10';
})());

/* ===================== 存取:唯一写入路径 ===================== */

section('写进去、读回来');
store.clear();
ok('空的时候读出来是空表', Object.keys(D.loadDayNotes()).length === 0);
D.setDayNote({}, '2026-10-15', 'sick', ' 低烧 ', TODAY);
const back = D.loadDayNotes();
ok('落到了 storage 里', back['2026-10-15']?.kind === 'sick');
ok('说明是洗干净再存的', back['2026-10-15']?.text === '低烧');
ok('写了就记一笔修改时间(云同步靠它判先后)', !!store.get('bodyos.sync.marks')?.['daynotes|main']);
ok('注意别和「每个动作的备注」串了 key', store.get('bodyos.training.notes') === undefined);
ok('上面那条不合法日期写不进去', Object.keys(D.setDayNote({}, '2026-11-30', 'sick', '', TODAY)).length === 0);
ok('销假:销掉就没了', Object.keys(D.clearDayNote(back, '2026-10-15')).length === 0);
ok('销一个本来就不在的日子 → 原样返回(引用都没变)', (() => {
  const n = {};
  return D.clearDayNote(n, '2026-10-15') === n;
})());

section('storage 里的脏数据进不了业务');
store.set('bodyos.training.daynotes', {
  '2026-10-15': { kind: 'sick', text: '', at: '' },
  '2026-02-30': { kind: 'sick', text: '', at: '' },
  '2026-10-16': { kind: '感冒', text: '', at: '' },
  '2026-10-17': null
});
ok('只留下读得懂的那一条', Object.keys(D.loadDayNotes()).length === 1);

/* ===================== 集成:欠账与提醒 ===================== */

section('请假之后,欠账跟着少');
const every2 = logsOf(everyN(2, 8, '2026-10-13')); // 节奏 2,上次 10-13
ok('没请假:隔 2 天 → 欠 1', Schedule.missedCount(P3, every2, TODAY) === 1);
ok('这两天都请了假 → 不欠了', Schedule.missedCount(P3, every2, TODAY, notes('10-14', '10-15')) === 0);
ok('只请了一天 → 还欠 1', Schedule.missedCount(P3, every2, TODAY, notes('10-14')) === 0,
  'gap 2 - 请假 1 = 1,1 < 节奏 2 → 不欠');
const every2b = logsOf(everyN(2, 8, '2026-10-09')); // 隔 6 天
ok('没请假:隔 6 天 → 欠 3', Schedule.missedCount(P3, every2b, TODAY) === 3);
ok('出差 4 天 → 只剩 1(回家的第二天就重新开始)', Schedule.missedCount(P3, every2b, TODAY, notes('10-10', '10-11', '10-12', '10-13')) === 1,
  String(Schedule.missedCount(P3, every2b, TODAY, notes('10-10', '10-11', '10-12', '10-13'))));
ok('不可能请出负数欠账', Schedule.missedCount(P3, every2b, TODAY,
  notes('10-10', '10-11', '10-12', '10-13', '10-14', '10-15')) === 0);
ok('今天练过就是 0,请假与否都不影响', Schedule.missedCount(P3, [...every2, log(TODAY)], TODAY, notes('10-15')) === 0);
ok('不传请假表 = 老行为(调用方不用改)', Schedule.missedCount(P3, every2, TODAY) === Schedule.missedCount(P3, every2, TODAY, {}));

section('请假的当天,一个字都不提醒');
const nudgeOf = (n) => Nudge.nudgeFor({ plan: P3, logs: every2, tone: 'gentle', notes: n }, TODAY);
ok('有欠账、没请假 → 会提醒', nudgeOf({})?.kind === 'due');
ok('今天请了假 → 闭嘴', nudgeOf(notes('10-15')) === null);
ok('请假只静音当天,不是从此装死', (() => {
  // 昨天请了假(欠账少一次)、但前面还欠着 → 今天该照常提醒
  const n = Nudge.nudgeFor({ plan: P3, logs: every2b, tone: 'gentle', notes: notes('10-14') }, TODAY);
  return n?.kind === 'due';
})());
ok('「回来就好」那一档也能被请假压下去', (() => {
  const back = Nudge.nudgeFor({ plan: P3, logs: every2b, tone: 'gentle', notes: {} }, TODAY);
  const backOff = Nudge.nudgeFor({ plan: P3, logs: every2b, tone: 'gentle', notes: notes('10-15') }, TODAY);
  return back?.kind === 'back' && backOff === null;
})());
ok('请假把「回来就好」拉回正常提醒(欠账从 3 降到 1)', (() => {
  const n = Nudge.nudgeFor({ plan: P3, logs: every2b, tone: 'gentle', notes: notes('10-10', '10-11', '10-12', '10-13') }, TODAY);
  return n?.kind === 'due' && n.missedCount === 1;
})());
ok('不传请假表 = 老行为', Nudge.nudgeFor({ plan: P3, logs: every2, tone: 'gentle' }, TODAY)?.missedCount === 1);

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
