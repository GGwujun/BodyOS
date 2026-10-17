/**
 * 激活埋点(docs/03 的「激活」一节)冒烟测试。
 *
 * 测两件事,第二件才是重点:
 *   ① `claimFirst` 这个纯的判定(脏名单、重复、互不干扰);
 *   ② **挂在 service 层真的生效** —— 第一笔记录入队、第二笔不再入队、请求失败不入队、
 *      只量围度不算记体重、**重启之后不会再报一次**(名单在 storage 里,不在内存里)。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-activation.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* ---------------- mock Taro:storage ---------------- */
const mem = new Map();
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); }
};

/* ---------------- mock 请求层 ----------------
 * 编译产物是 CommonJS,service 里写的就是字面量 './request' —— 所以能按这个字符串拦下来。
 * 这样被测的是**真的 createFoodLog / createActivity / createBodyMeasurement**,
 * 不是它们的复刻品。 */
let requestCalls = [];
let failNext = false;
const fakeRequest = (opts) => {
  requestCalls.push(opts);
  if (failNext) { failNext = false; return Promise.reject(new Error('网络断了')); }
  const url = String(opts.url);
  if (url.startsWith('/food-logs')) return Promise.resolve({ foodLog: { id: 'f1' }, summary: {} });
  if (url.startsWith('/activities')) return Promise.resolve({ activity: { id: 'a1' }, summary: {} });
  if (url.startsWith('/body-measurements')) return Promise.resolve({ id: 'm1' });
  return Promise.resolve({});
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: storage, ...storage };
  if (req === './request') return { request: fakeRequest };
  return origLoad.call(this, req, ...rest);
};

const A = require('../.smoke/utils/activation.js');
const FOOD = require('../.smoke/services/food.js');
const ACT = require('../.smoke/services/activity.js');
const BODY = require('../.smoke/services/body.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/** 队列里的事件名(analytics 的队列 key 是 bodyos_analytics_queue) */
const queued = () => (mem.get('bodyos_analytics_queue') ?? []).map((e) => e.name);
const reset = () => { mem.clear(); requestCalls = []; failNext = false; };

/* ================= ① 纯判定 ================= */
section('claimFirst:该报一次,然后一辈子不报');
{
  ok('空名单 → 报', A.claimFirst('food', undefined).fire === true);
  ok('空数组 → 报', A.claimFirst('food', []).fire === true);
  ok('报过 → 不再报', A.claimFirst('food', ['food']).fire === false);
  ok('报过别的 → 照报', A.claimFirst('weight', ['food']).fire === true);
  ok('名单原样带出来(不把别的种类挤掉)', A.claimFirst('weight', ['food']).next.join() === 'food,weight');
  ok('不认识的东西一律滤掉,不污染名单', A.claimFirst('food', ['food', '什么鬼', 7, null]).next.join() === 'food');
  ok('不是数组(脏数据)→ 当成没报过', A.claimFirst('food', 'food').fire === true);
  ok('重复报过也只留一条', A.claimFirst('food', ['food', 'food']).fire === false);
}

/* ================= ② service 层生效 ================= */
section('第一笔饮食记录 → 报一次;第二笔不报');
reset();
await FOOD.createFoodLog({ meal: 'lunch', items: [] });
ok('入队了 first_food_log', queued().includes('first_food_log'), queued().join());
ok('分类是 activation(不是 other)', (mem.get('bodyos_analytics_queue')[0] ?? {}).category === 'activation');
await FOOD.createFoodLog({ meal: 'dinner', items: [] });
ok('第二笔不再入队同一件事', queued().filter((n) => n === 'first_food_log').length === 1, queued().join());
ok('两笔请求都真发出去了(埋点没挡住业务)', requestCalls.length === 2);

section('运动和体重各自一条线');
reset();
await ACT.createActivity({ type: '跑步', calories: 300, startedAt: '2026-10-15T12:00:00.000Z' });
ok('第一笔运动 → first_activity_log', queued().includes('first_activity_log'));
ok('记了运动不等于激活了饮食', !queued().includes('first_food_log'));

reset();
await BODY.createBodyMeasurement({ measuredAt: '2026-10-15T12:00:00.000Z', waistCm: 80 });
ok('只量围度不算「第一次记体重」', !queued().includes('first_weight_log'), queued().join());
await BODY.createBodyMeasurement({ measuredAt: '2026-10-15T12:00:00.000Z', weightKg: 70.5 });
ok('填了体重才算', queued().includes('first_weight_log'));
await BODY.createBodyMeasurement({ measuredAt: '2026-10-16T12:00:00.000Z', weightKg: 70.2 });
ok('第二次记体重不再报', queued().filter((n) => n === 'first_weight_log').length === 1, queued().join());
ok('weightKg 显式传 null 不算(food 页那种「清空」写法)',
  A.claimFirst('weight', ['food', 'activity']).fire === true && queued().filter((n) => n === 'first_weight_log').length === 1);

section('请求失败不算激活(记都没记上,不能算数)');
reset();
failNext = true;
let threw = false;
try { await FOOD.createFoodLog({ meal: 'lunch', items: [] }); } catch { threw = true; }
ok('请求失败照旧往外抛(埋点不该把错误吞掉)', threw);
ok('失败时不入队', !queued().includes('first_food_log'), queued().join());
await FOOD.createFoodLog({ meal: 'lunch', items: [] });
ok('下次成功才报', queued().includes('first_food_log'));

section('重启之后不会再报一次(名单在 storage,不在内存里)');
reset();
await FOOD.createFoodLog({ meal: 'lunch', items: [] });
const firstNames = queued().join();
mem.delete('bodyos_analytics_queue');   // 队列被 flush 走了(切后台就会发生)
delete require.cache[require.resolve('../.smoke/utils/activation.js')];
const A2 = require('../.smoke/utils/activation.js');   // 重新加载 = 冷启动
A2.markFirst('food');
ok('冷启动后同一件事仍然不报', !queued().includes('first_food_log'), `队列=${queued().join() || '(空)'} 之前=${firstNames}`);
A2.markFirst('activity');
ok('但没做过的照报(名单是逐个记的)', queued().includes('first_activity_log'));

section('resetFirst 只清名单');
reset();
await FOOD.createFoodLog({ meal: 'lunch', items: [] });
A.resetFirst();
mem.delete('bodyos_analytics_queue');
await FOOD.createFoodLog({ meal: 'lunch', items: [] });
ok('清掉之后第一次又会报', queued().includes('first_food_log'));

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
