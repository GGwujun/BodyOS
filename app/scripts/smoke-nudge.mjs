/**
 * M8.1 训练提醒 冒烟测试 —— 节奏推断、欠账计算、以及「什么时候该闭嘴」。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-nudge.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * 假 storage。schedule 现在经 daynote 间接依赖 Taro(请假要读写本机存储),
 * 桩必须在这里就位 —— 少了它报出来的是 Taro 内部的一堆栈,看不出跟请假有关。
 * `default` 那一份不能省:编译产物是 __importDefault(require(...))。
 */
const store = new Map();
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    const storage = {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => store.set(k, v),
      removeStorageSync: (k) => store.delete(k)
    };
    return { default: storage, ...storage };
  }
  return origLoad.call(this, req, ...rest);
};

const Schedule = require('../.smoke/pkg-exercise/engine/schedule.js');
const N = require('../.smoke/pkg-exercise/engine/nudge.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/** 造计划:days 个训练日,每周 daysPerWeek 天 */
const plan = (keys, daysPerWeek = 3) => ({
  id: 'p1', createdAt: '2026-09-01T00:00:00.000Z', goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek, sessionMin: 45, doneCount: 0, lastNote: '',
  days: keys.map((k, i) => ({ key: k, title: `第 ${i + 1} 天 · ${k}`, focus: '', estMin: 45, items: [] }))
});

/** 本地 YYYY-MM-DD —— 不能用 toISOString():东八区下 10-13T00:00 会退成 10-12 */
const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 从日期数组造日志(只用到 date / dayKey) */
const logsOf = (dates, dayKey = 'a') =>
  dates.map((d) => ({ id: `${dayKey}-${d}`, planId: 'p1', dayKey, dayTitle: '', date: d }));
const log = (date, dayKey = 'a') => ({ id: `${dayKey}-${date}`, planId: 'p1', dayKey, dayTitle: '', date });

/** 每隔 n 天练一次,最后一次是 end(含),共 count 次 */
const everyN = (n, count, end) => {
  const out = [];
  const d = new Date(`${end}T00:00:00`);
  for (let i = 0; i < count; i++) { out.unshift(iso(d)); d.setDate(d.getDate() - n); }
  return out;
};

const TODAY = '2026-10-15';
const P3 = plan(['a', 'b', 'c'], 3);

section('下一个该练哪天');
ok('从没练过的训练日优先', Schedule.nextDayKey(P3, logsOf(['2026-10-10'], 'a')) === 'b', Schedule.nextDayKey(P3, logsOf(['2026-10-10'], 'a')));
// 老计划没有 schedule = 按训练日顺序轮转:一轮全做完后从「刚做完那套的后面」接着来。
// 最后练的是 a,顺序 a→b→c,所以下一套是 b(不是「最久没练的」c —— 那是没有轮转概念时的口径)。
ok('都练过就按轮转顺序接着来', Schedule.nextDayKey(P3, [log('2026-10-14', 'a'), log('2026-10-13', 'b'), log('2026-10-01', 'c')]) === 'b');
ok('同一天练两次算一天', (() => {
  const p2 = plan(['a', 'b']);
  const logs = [...logsOf(['2026-10-10'], 'a'), ...logsOf(['2026-10-10'], 'a')];
  return Schedule.nextDayKey(p2, logs) === 'b';
})());
ok('日志里的陌生 dayKey(计划换过了)不参与比较', (() => {
  const records = [...logsOf(['2026-10-14'], 'zzz'), ...logsOf(['2026-10-10'], 'a')];
  // a 练于 10-10、b/c 从没练过 → 该练 b(不是被 zzz 干扰后的 a)
  return Schedule.nextDayKey(P3, records) === 'b';
})());
ok('空计划返回空串', Schedule.nextDayKey(plan([]), []) === '');
ok('nextDayOf 拿得到整天', Schedule.nextDayOf(P3, logsOf(['2026-10-10'], 'a'))?.key === 'b');
ok('没有计划就没有下一个训练日', Schedule.nextDayOf(null, []) === null);

section('推断训练节奏');
ok('每 2 天练一次 → 节奏 2', Schedule.rhythmDays(P3, logsOf(everyN(2, 8, '2026-10-14'))) === 2);
ok('每 3 天练一次 → 节奏 3', Schedule.rhythmDays(P3, logsOf(everyN(3, 6, '2026-10-14'))) === 3);
ok('周末连练两天也能被中位数吸收', (() => {
  // 实际间隔 3,3,1,3,3,1 → 中位数 3
  const d = ['2026-09-26', '2026-09-28', '2026-09-29', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-09'];
  return Schedule.rhythmDays(P3, logsOf(d)) === 3;
})());
ok('记录太少时退回计划的每周天数(每周 3 天 → 2)', Schedule.rhythmDays(P3, logsOf(['2026-10-14', '2026-10-12'])) === 2);
ok('每周 5 天 → 节奏 1', Schedule.rhythmDays(plan(['a'], 5), logsOf(['2026-10-14'])) === 1);
ok('每周 2 天 → 节奏 4', Schedule.rhythmDays(plan(['a'], 2), logsOf(['2026-10-14'])) === 4);
ok('什么都没有也不会算出 NaN', Schedule.rhythmDays(null, []) === 3);
ok('离谱的间隔被压到上限 7', Schedule.rhythmDays(null, logsOf(everyN(30, 6, '2026-10-14'))) === 7);
ok('同一天的多条日志不会算出 0 间隔', Schedule.rhythmDays(P3, logsOf(['2026-10-14', '2026-10-14', '2026-10-12', '2026-10-12'])) === 2);

section('欠了几次');
const every2 = logsOf(everyN(2, 8, '2026-10-14'));   // 节奏 2,上次是昨天
ok('今天练过 = 不欠', Schedule.missedCount(P3, logsOf([...everyN(2, 8, '2026-10-14'), TODAY]), TODAY) === 0);
ok('昨天练过、节奏 2 → 还没到该练的时候', Schedule.missedCount(P3, every2, TODAY) === 0);
ok('隔 2 天 → 欠 1', Schedule.missedCount(P3, logsOf(everyN(2, 8, '2026-10-13')), TODAY) === 1);
ok('隔 5 天 → 欠 2(第 2、4 天各欠一次)', Schedule.missedCount(P3, logsOf(everyN(2, 8, '2026-10-10')), TODAY) === 2);
ok('隔 6 天 → 欠 3', Schedule.missedCount(P3, logsOf(everyN(2, 8, '2026-10-09')), TODAY) === 3);
ok('有计划但一次没练过 → 欠 1(第一练还没开张)', Schedule.missedCount(P3, [], TODAY) === 1);
ok('没有计划、也没有日志 → 不欠', Schedule.missedCount(null, [], TODAY) === 0);

section('今天该不该提一句');
ok('没有计划就不提(没有「该练哪天」可言)', N.nudgeFor({ plan: null, logs: [] }, TODAY) === null);
ok('空计划不提', N.nudgeFor({ plan: plan([]), logs: [] }, TODAY) === null);
ok('今天练过就不提', N.nudgeFor({ plan: P3, logs: [...every2, log(TODAY)] }, TODAY) === null);
ok('还没到该练的时候不提', N.nudgeFor({ plan: P3, logs: every2 }, TODAY) === null);

const due = N.nudgeFor({ plan: P3, logs: logsOf(everyN(2, 8, '2026-10-13')) }, TODAY);
ok('该练的时候提一句', due?.kind === 'due', JSON.stringify(due && [due.kind, due.title]));
ok('说的是下一个该练的训练日', due?.dayKey === 'b' && due.dayTitle.includes('b'), due?.dayTitle);
ok('欠账数和间隔都对得上', due?.missedCount === 1 && due?.gapDays === 2, `missed=${due?.missedCount} gap=${due?.gapDays}`);
ok('正文里没有留下没替换的 {0}', !due?.line.includes('{0}'), due?.line);
ok('温和档默认就是温和', due?.tone === 'gentle' && due?.title === '今天练不练?');

section('同一天同一句话,隔天换一句(不刷一次变一句)');
const same = N.nudgeFor({ plan: P3, logs: logsOf(everyN(2, 8, '2026-10-13')) }, TODAY);
ok('同一天反复取结果一致', same?.line === due?.line);
const days4 = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
const idx4 = days4.map((d) => N.lineIndex(d, 4));
ok('连着四天的下标正好是 0/1/2/3(一天一句,轮完一圈)', [...idx4].sort().join() === '0,1,2,3', idx4.join());
ok('每档语气的四句话顺序也被轮换取到', new Set(idx4.map((i) => N.NUDGE_COPY.gentle.lines[i])).size === 4);
const lines7 = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
  .map((d) => N.nudgeFor({ plan: P3, logs: logsOf(everyN(2, 8, '2026-10-13')) }, d)?.line);
ok('连着 7 天里出现过不止一句话(不会天天同一句)', new Set(lines7.filter(Boolean)).size > 1, `${new Set(lines7.filter(Boolean)).size} 句`);
ok('lineIndex 越界也会绕回合法下标', [1, 2, 3, 4].every((n) => N.lineIndex(TODAY, n) >= 0 && N.lineIndex(TODAY, n) < n));
ok('lineIndex 对 n=0 不炸', N.lineIndex(TODAY, 0) === 0);
ok('lineIndex 对坏日期不炸', N.lineIndex('随便写的', 4) === 0);

section('欠太多就闭嘴(但不装死)');
const back = N.nudgeFor({ plan: P3, logs: logsOf(everyN(2, 8, '2026-10-09')) }, TODAY);
ok('欠满 3 次换成「回来就好」', back?.kind === 'back' && back?.title === '回来就好', `${back?.kind}/${back?.title}`);
ok('「回来就好」不列欠账数字', N.BACK_COPY.lines.includes(back?.line), back?.line);
ok('「回来就好」不提训练日名(免得像催)', !back?.line.includes(back.dayTitle));
ok('欠 3 次仍然给出欠账数(设置页/统计要看)', back?.missedCount === 3);
ok('欠 4 次还是「回来就好」,不会回到催促', N.nudgeFor({ plan: P3, logs: logsOf(everyN(2, 8, '2026-10-07')) }, TODAY)?.kind === 'back');
ok('回来练一次之后重新开始催', (() => {
  const r = N.nudgeFor({ plan: P3, logs: logsOf(everyN(2, 8, '2026-10-13')) }, TODAY);
  return r?.kind === 'due';
})());

section('第一次开练的人');
const first = N.nudgeFor({ plan: P3, logs: [] }, TODAY);
ok('有计划、一次没练过 → 也要提一句', first?.kind === 'due');
ok('标出 firstTime', first?.firstTime === true && first?.gapDays === null && first?.lastDate === null);
ok('说的话是「先开个头」那组,不是「你怎么没练」', N.FIRST_COPY.lines.includes(first?.line), first?.line);
ok('没说「欠」字', !first?.line.includes('欠'), first?.line);

section('语气');
ok('默认温和', N.toneOf(undefined) === 'gentle' && N.toneOf('乱七八糟') === 'gentle');
ok('三档语气都认得', N.toneOf('fun') === 'fun' && N.toneOf('cheer') === 'cheer');
const fun = N.nudgeFor({ plan: P3, logs: logsOf(everyN(2, 8, '2026-10-13')), tone: 'fun' }, TODAY);
ok('幽默档换标题换正文', fun?.title === '你的肌肉开了个会' && N.NUDGE_COPY.fun.lines.includes(fun.line), fun?.line);
const cheer = N.nudgeFor({ plan: P3, logs: logsOf(everyN(2, 8, '2026-10-13')), tone: 'cheer' }, TODAY);
ok('打气档换标题', cheer?.title === '今天该练了');
ok('每档都是 4 句', N.NUDGE_TONES.every((t) => N.NUDGE_COPY[t].lines.length === 4));
ok('每档都有中文名和说明(设置页要显示)', N.NUDGE_TONES.every((t) => N.NUDGE_TONE_ZH[t] && N.NUDGE_TONE_DESC[t]));

section('文案红线与格式');
const allCopy = [
  ...N.NUDGE_TONES.flatMap((t) => [N.NUDGE_COPY[t].title, ...N.NUDGE_COPY[t].lines]),
  N.BACK_COPY.title, ...N.BACK_COPY.lines, ...N.FIRST_COPY.lines
];
ok('提醒文案里没有禁词(AI/智能/大模型/智谱)', !allCopy.some((t) => /AI|智能|大模型|智谱/i.test(t)));
ok('文案都不为空、不超长(推送标题有长度限制)', allCopy.every((t) => t.length > 0 && t.length <= 30), `最长 ${Math.max(...allCopy.map((t) => t.length))} 字`);
ok('训练日名会被替换进正文', N.fillCopy('今天练 {0} 吧', '推日') === '今天练 推日 吧');
ok('{0} 出现多次也全换', N.fillCopy('{0} 和 {0}', '拉日') === '拉日 和 拉日');

section('卡片上的小字');
ok('还没开张', N.gapText(null, 1) === '还没开张');
ok('昨天练过', N.gapText(1, 1) === '昨天刚练过', N.gapText(1, 1));
ok('刚开始欠 → 说距上次几天', N.gapText(2, 1) === '距上次训练 2 天');
ok('欠了好几次 → 说多少天没练', N.gapText(6, 3) === '已经 6 天没练了');

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
