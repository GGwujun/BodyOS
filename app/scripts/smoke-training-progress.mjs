/**
 * 「练了这么久有没有变」那张长程快照的冒烟测试 —— 算得对、存得住、读得进来。
 *
 * 这张快照要钉死的是**口径**,不是存取(存取那边有 smoke-draft 那一套的做法可抄):
 * 它上面挂着一句给用户看的话(「近 30 天练了 12 天 · 比前 30 天多 3 天」),
 * 这句话错在哪都没人看得出来 —— 少算一天不会崩,只是悄悄骗人。
 * 所以这儿测三件事:
 *   1. **算得对** —— 窗口是闭区间、同一天练两场只算一天、补录的算真练过;
 *   2. **坏数据读不进来** —— 它读回来的东西直接进趋势页的渲染;
 *   3. **时间档跟着页面走** —— 用户在趋势页选 7 天,这一块就得按 7 天算。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-training-progress.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** 假 storage:顺便数「写了几次」—— 进训练区每次都会算一遍,去重是关键行为 */
const store = new Map();
let writes = 0;
let boom = false;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    const storage = {
      getStorageSync: (k) => {
        if (boom) throw new Error('storage 读不了');
        return store.has(k) ? store.get(k) : '';
      },
      setStorageSync: (k, v) => {
        if (boom) throw new Error('storage 写不了');
        writes++;
        store.set(k, v);
      },
      removeStorageSync: (k) => store.delete(k)
    };
    return { default: storage, ...storage };
  }
  return origLoad.call(this, req, ...rest);
};

const P = require('../.smoke/utils/training-progress.js');
const E = require('../.smoke/pkg-exercise/engine/progress.js');
const KEY = 'bodyos.training.progress';

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);
const inject = (obj) => { store.set(KEY, obj); };
const reset = () => { store.clear(); writes = 0; };

/** 今天的日期从系统取,别写死 —— 窗口是按今天倒推的 */
const p2 = (n) => String(n).padStart(2, '0');
const ago = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
const today = ago(0);

/** 一场训练(只带 progressOf 会用到的字段) */
const log = (date, entry = {}) => ({
  id: date, planId: 'p', dayKey: 'd1', dayTitle: '推日', date,
  durationSec: 600, totalSets: 3, totalReps: 24, totalVolumeKg: 1000, avgRir: 2,
  entries: [{
    exerciseId: 'bench-press', nameZh: '卧推',
    sets: [{ reps: 8, weightKg: 50, done: true, rir: 2 }]
  }],
  ...entry
});

section('算:日子、次数、天数');
{
  const logs = [log(ago(0)), log(ago(1)), log(ago(1))];  // 昨天两场
  const p = E.progressOf(logs);
  ok('一共 3 次', p.total === 3, `total=${p.total}`);
  ok('只算 2 天(同一天两场算一天)', p.days === 2, `days=${p.days}`);
  ok('日子串是倒序的、不重复', p.marks.join(',') === [ago(0), ago(1)].join(','), p.marks.join(','));
  ok('最近一次那天叫什么跟着走', p.lastTitle === '推日');
}

section('算:窗口边界 —— 「近 7 天」得和服务端切的一模一样');
{
  ok('0 天前就是今天', P.daysAgo(0, today) === today);
  ok('6 天前算得对', P.daysAgo(6, today) === ago(6));
  // 服务端 GET /trends?range=7 切的是 [今天-6, 今天] 这 7 天 —— 训练这一块必须同宽
  const p = { total: 9, days: 9, marks: [ago(0), ago(6), ago(7), ago(13), ago(14)], lastTitle: '', lifts: [] };
  ok('近 7 天 = 今天到 6 天前(共 7 天)', P.trainedIn(p, 7, today) === 2, `got=${P.trainedIn(p, 7, today)}`);
  ok('第 7 天前那天在窗口外', P.trainedIn(p, 7, today) === 2);
  ok('再宽一天就把它收进来', P.trainedIn(p, 8, today) === 3, `got=${P.trainedIn(p, 8, today)}`);
  ok('近 14 天 = [13 天前, 今天]', P.trainedIn(p, 14, today) === 4, `got=${P.trainedIn(p, 14, today)}`);
  ok('未来的日子不算(本地时钟被往回调过)', P.trainedIn({ ...p, marks: [ago(-3)] }, 7, today) === 0);
}

section('算:纪录取「最近破的」三个,不按重量排');
{
  const old = log(ago(40), { entries: [{ exerciseId: 'squat', nameZh: '深蹲', sets: [{ reps: 5, weightKg: 100, done: true, rir: 2 }] }] });
  const recent = log(ago(1), { entries: [{ exerciseId: 'curl', nameZh: '弯举', sets: [{ reps: 8, weightKg: 20, done: true, rir: 2 }] }] });
  const p = E.progressOf([old, recent, log(ago(2)), log(ago(3)), log(ago(4))]);
  ok('最多三条', p.lifts.length <= 3, `n=${p.lifts.length}`);
  ok('最近破的那条排第一(弯举,不是更重的深蹲)', p.lifts[0]?.name === '弯举', `first=${p.lifts[0]?.name}`);
  ok('纪录带日期', /^\d{4}-\d{2}-\d{2}$/.test(p.lifts[0]?.date ?? ''), `date=${p.lifts[0]?.date}`);
}

section('写下去再读回来,一项不少');
{
  reset();
  const p = E.progressOf([log(ago(0)), log(ago(3))]);
  P.saveTrainingProgress(p);
  const back = P.loadTrainingProgress();
  ok('读得回来', !!back);
  ok('次数/天数活着', back.total === 2 && back.days === 2);
  ok('日子串活着', back.marks.length === 2);
  ok('纪录活着', back.lifts.length === 1 && back.lifts[0].name === '卧推');
}

section('没练过 = 没有这一块(趋势页据此给一句别的)');
{
  reset();
  ok('存储里什么都没有 → null', P.loadTrainingProgress() === null);
  P.saveTrainingProgress(E.progressOf([]));
  ok('算出来 0 次 → 不写', !store.has(KEY));
  inject({ total: 0, days: 0, marks: [], lastTitle: '', lifts: [] });
  ok('就算存进去 0 次的也被当成没有', P.loadTrainingProgress() === null);
}

section('坏数据读不进来(它直接进趋势页渲染)');
{
  reset();
  const bad = [null, 0, 'x', {}, { total: '很多' }, { total: -1 }, { total: NaN }, { total: 1e9 }];
  ok('一份都读不成', bad.every((b) => { inject(b); return P.loadTrainingProgress() === null; }));
}

section('个别字段收窄:只丢那一个,不整份丢');
{
  reset();
  inject({
    total: 5, days: 3,
    marks: [ago(0), '不是日期', null, ago(1), ago(2)],
    lastTitle: '推日',
    lifts: [
      { name: '卧推', kg: 60, date: ago(1) },
      { name: '', kg: 60, date: ago(1) },          // 没名字
      { name: '深蹲', kg: '很重', date: ago(1) },   // 重量不是数
      { name: '硬拉', kg: 100, date: '前天' },      // 日期不成形
      { name: '弯举', kg: 20, date: ago(2) }
    ]
  });
  const d = P.loadTrainingProgress();
  ok('这份还读得出来', !!d);
  ok('日子串里只留成形的那几天', d.marks.join(',') === [ago(0), ago(1), ago(2)].join(','), d.marks.join(','));
  ok('三个坏纪录被丢掉,留下两个好的', d.lifts.length === 2 && d.lifts[0].name === '卧推' && d.lifts[1].name === '弯举');
  ok('天数被夹在总次数以内', d.days <= d.total);
}

section('日子串有上限 —— 一份 300 次的历史不该撑爆存储');
{
  reset();
  const many = Array.from({ length: 300 }, (_, i) => log(ago(i)));
  const p = E.progressOf(many);
  ok(`最多留 ${P.MARKS_MAX} 天`, p.marks.length === P.MARKS_MAX, `n=${p.marks.length}`);
  ok('留的是最近的(新在前)', p.marks[0] === ago(0));
  P.saveTrainingProgress(p);
  ok('存进去读回来还是这个数', P.loadTrainingProgress().marks.length === P.MARKS_MAX);
}

section('去重 —— 进训练区每次都会算一遍,内容没变就不该重复写');
{
  reset();
  const p = E.progressOf([log(ago(0))]);
  P.saveTrainingProgress(p);
  const after1 = writes;
  P.saveTrainingProgress(E.progressOf([log(ago(0))]));
  ok('同样的内容再来一次不写', writes === after1, `writes=${writes}`);
  P.saveTrainingProgress(E.progressOf([log(ago(0)), log(ago(1))]));
  ok('多练了一场就写', writes === after1 + 1, `writes=${writes}`);
}

section('文案:口径跟着页面的时间档走');
{
  const p = { total: 9, days: 8, marks: [ago(0), ago(1), ago(2), ago(5), ago(40)], lastTitle: '推日', lifts: [] };
  const v7 = P.progressView(p, 7, today);
  ok('7 天档 = 那句按 7 天说', v7.recent === '近 7 天练了 4 天', v7.recent);
  const v30 = P.progressView(p, 30, today);
  ok('30 天档跟着变', v30.recent === '近 30 天练了 4 天', v30.recent);
  // 40 天前那场落在「前 30 天」那一段里,不进本段 —— 这是对的,得钉住
  ok('40 天前那场算进「前 30 天」而不是本段', v30.delta === '比前 30 天多 3 天', v30.delta);
  ok('总数用「次 · 天」两个口径说清', v30.total === '一共 9 次 · 8 天', v30.total);
  ok('最近一次带那天叫什么', v30.last === `${Number(ago(0).slice(5, 7))} 月 ${Number(ago(0).slice(8, 10))} 日(推日)`, v30.last);
}
{
  const empty = { total: 1, days: 1, marks: [], lastTitle: '', lifts: [] };
  const v = P.progressView(empty, 7, today);
  ok('一次都没在窗口里练过也不编涨跌', v.delta === '', `delta="${v.delta}"`);
  ok('没有最近一次就不写那半句', v.last === '');
}

section('storage 抛错:读、写都不该把训练流程带崩');
{
  reset();
  P.saveTrainingProgress(E.progressOf([log(ago(0))]));
  boom = true;
  ok('读不了 → 当作没有这一块', P.loadTrainingProgress() === null);
  ok('写不了也不抛', (() => { try { P.saveTrainingProgress(E.progressOf([log(ago(0))])); return true; } catch { return false; } })());
  boom = false;
}

console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
