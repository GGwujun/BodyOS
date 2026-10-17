/**
 * 力量训练 → 热量引擎的回写冒烟测试(`pkg-exercise/engine/workout-energy.ts`)。
 *
 * 这一层管的是**首页那个「消耗」数里到底有没有算上你刚练的那一小时**。
 * 它错起来是安静的:数量少一笔而已,界面上什么都不报错 ——
 * 所以每条路径都要在这里钉住:
 *
 *   ① 换算(MET 公式、分钟取整、没时长不写、读不到体重按 65 估);
 *   ② **幂等** —— 同一条日志反复回写只该有一条记录(补录/改时长都会再走一遍);
 *   ③ 改日期时那笔消耗要**跟着走过去**,不能在旧日期留一条孤儿;
 *   ④ 这一条不算「用了运动功能」(激活埋点不该被它点亮);
 *   ⑤ **补写历史** —— 这一层上线之前练过的那几十次,得靠它才进得了账。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-workout-energy.mjs
 */
import { createRequire } from 'module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

/* ---------------- mock Taro:storage(激活埋点的队列落在它上面) ---------------- */
const mem = new Map();
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); }
};

/* ---------------- mock 请求层 ----------------
 * 编译产物是 CommonJS,service 里引的就是字面量 './request',按这个字符串拦下来,
 * 被测的就是**真的** createActivity / updateActivity / listActivities,不是复刻品。 */
let calls = [];
let profile = { weightKg: 70 };
let profileFails = false;
/** 模拟「网络断在写这一步」—— 读得到、写不进去 */
let postFails = false;
/** date → 那天已有的活动记录(模拟服务端) */
let serverByDate = {};
let idSeq = 0;

/** 服务端由 startedAt 反推归属日期(见 server/src/lib/date.ts 的 toDateStr,走本地时区) */
const localDate = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const allRows = () => Object.values(serverByDate).flat();
/** 只数写请求(POST/PUT)。读是幂等判断的必要前提,不该和写混在一起数 */
const writes = () => calls.filter((c) => c.method === 'POST' || c.method === 'PUT');

const fakeRequest = (opts) => {
  calls.push({ ...opts });
  const url = String(opts.url);
  const method = opts.method || 'GET';
  if (url.startsWith('/profile')) {
    if (profileFails) return Promise.reject(new Error('网络断了'));
    return Promise.resolve(profile);
  }
  if (url.startsWith('/activities?')) {
    // 用真解析而不是 split('date=')[1]:分页参数跟在后面,split 会把
    // 「2026-10-16&page=1&pageSize=100」当成日期,读到的永远是空 ——
    // 幂等判断就永远以为没写过,每次都新建一条
    const date = new URL(url, 'http://smoke.local').searchParams.get('date') ?? '';
    const items = serverByDate[date] ?? [];
    return Promise.resolve({ items, total: items.length });
  }
  if (url === '/activities' && method === 'POST') {
    if (postFails) return Promise.reject(new Error('断了'));
    const data = opts.data ?? {};
    const row = { id: `act-${++idSeq}`, ...data };
    const d = localDate(data.startedAt);
    serverByDate[d] = [...(serverByDate[d] ?? []), row];
    return Promise.resolve({ activity: row, summary: {} });
  }
  if (url.startsWith('/activities/') && method === 'PUT') {
    const id = url.slice('/activities/'.length);
    const hit = allRows().find((a) => a.id === id);
    if (!hit) return Promise.reject(new Error('记录不存在'));
    const wasOn = localDate(hit.startedAt);
    Object.assign(hit, opts.data);
    // 带了 startedAt 就相当于这条记录搬了家
    if (opts.data.startedAt) {
      serverByDate[wasOn] = (serverByDate[wasOn] ?? []).filter((a) => a.id !== id);
      const to = localDate(hit.startedAt);
      (serverByDate[to] ??= []).push(hit);
    }
    return Promise.resolve({ activity: hit, summary: {} });
  }
  return Promise.resolve({});
};

const Module = require('module');
const HERE = dirname(fileURLToPath(import.meta.url));
const origLoad = Module._load;

Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: storage, ...storage };
  if (req === './request') return { request: fakeRequest };
  // 编译产物里保留着 '@/' 别名(tsc 不改写路径),Node 认不出来,这里手动映射到 .smoke
  if (req.startsWith('@/')) return origLoad.call(this, join(HERE, '..', '.smoke', req.slice(2)), ...rest);
  return origLoad.call(this, req, ...rest);
};

const MOD = '../.smoke/pkg-exercise/engine/workout-energy.js';
const ENERGY = require(MOD);

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);
const queued = () => (mem.get('bodyos_analytics_queue') ?? []).map((e) => e.name);

/**
 * 体重是会话内缓存一次的(见 workout-energy 的 weightCache),而这一层的行为
 * **取决于读到的体重对不对** —— 换个 profile 就得把模块重新加载一遍,
 * 否则测的还是上一节那个体重。
 */
function fresh(profilePatch) {
  if (profilePatch) profile = profilePatch;
  delete require.cache[require.resolve(MOD)];
  calls = [];
  serverByDate = {};
  idSeq = 0;
  mem.clear();
  return require(MOD);
}
const log = (over = {}) => ({
  id: 'wo-1', planId: 'p1', dayKey: 'd1', dayTitle: '推日', date: '2026-10-16',
  durationSec: 45 * 60, totalSets: 12, totalReps: 100, totalVolumeKg: 2000,
  avgRir: null, entries: [], ...over
});

/* ================= ① 换算 ================= */
section('MET 换算:力量训练这一档不该是空的');
{
  const W = fresh({ weightKg: 70 });
  // 教科书公式 kcal = MET × 3.5 × kg ÷ 200 × min,和运动页 estimateCalories 同一个
  const expect = Math.round((3.5 * 3.5 * 70 * 45) / 200);
  ok('45 分钟 / 70kg 的结果和公式对得上', W.workoutKcal(45 * 60, 70) === expect, `${W.workoutKcal(45 * 60, 70)} vs ${expect}`);
  ok('时长按分钟取整(44分59秒 → 45 分钟那一档)', W.workoutKcal(2699, 70) === W.workoutKcal(2700, 70));
  ok('1 分钟也照样有值(不因为短就丢掉)', W.workoutKcal(60, 70) > 0);
  ok('没有时长 → null(不写一笔 0 kcal 的记录)', W.workoutKcal(0, 70) === null);
  ok('负时长/NaN → null', W.workoutKcal(-60, 70) === null && W.workoutKcal(NaN, 70) === null);
  ok('体重未知时按 65kg 估,而不是不记', W.workoutKcal(45 * 60, null) === Math.round((3.5 * 3.5 * 65 * 45) / 200));
  // 力量训练必须真的在 MET 表里 —— 少了这一条,整条链路一行都不写,而且不报错
  ok('这个类型在运动页的类型表里(用户点进去改要认得出来)', W.STRENGTH_ACTIVITY_TYPE === '力量训练');
}

/* ================= ② 建 ================= */
section('练完 → 写一条活动记录');
{
  const W = fresh({ weightKg: 70 });
  const r = await W.syncWorkoutActivity(log(), { startedAtMs: Date.parse('2026-10-16T20:30:00') });
  ok('返回 created', r === 'created', String(r));
  const post = calls.find((c) => c.method === 'POST');
  ok('发的是 POST /activities', !!post);
  ok('类型是力量训练', post?.data.type === '力量训练');
  ok('带了时长(有它的才进「运动消耗」而不是「日常活动」)', post?.data.durationMin === 45, String(post?.data.durationMin));
  ok('消耗不为 0', post?.data.calories > 0, String(post?.data.calories));
  ok('挂在日志 id 上(externalId = 幂等的钩子)', post?.data.externalId === 'wo-1');
  ok('source 标成 training(和手动记的区分得开)', post?.data.source === 'training');
  ok('开始时刻用真实那一刻,不是当天中午', new Date(post.data.startedAt).getHours() === 20, String(post?.data.startedAt));
  ok('**没有**点亮「第一次运动记录」埋点(这不是用了运动功能)', !queued().includes('first_activity_log'), queued().join());
}

/* ================= ③ 幂等 ================= */
section('同一条日志反复回写,只该有一条记录');
{
  const W = fresh({ weightKg: 70 });
  await W.syncWorkoutActivity(log());
  const writesBefore = writes().length;
  const r2 = await W.syncWorkoutActivity(log());
  // 读一次是要的(得先知道有没有写过),**写**一次都不该有 —— 断言写成「一个请求都没发」
  // 就会把一次正确的、必要的 GET 判成失败
  ok('第二次一个写请求都没发', r2 === 'skipped' && writes().length === writesBefore, `${r2} / 多了 ${writes().length - writesBefore} 个写请求`);
  ok('服务端那边仍然只有一条', allRows().length === 1, String(allRows().length));
}

section('改时长 → 改那一条,不是再建一条');
{
  const W = fresh({ weightKg: 70 });
  await W.syncWorkoutActivity(log());
  const before = { ...allRows()[0] };
  const r = await W.syncWorkoutActivity(log({ durationSec: 70 * 60 }));
  ok('返回 updated', r === 'updated', String(r));
  const put = calls.find((c) => c.method === 'PUT');
  ok('改的是原来那条记录', String(put?.url) === `/activities/${before.id}`, String(put?.url));
  ok('时长跟着改了', put?.data.durationMin === 70, String(put?.data.durationMin));
  ok('消耗也跟着改了', put?.data.calories > before.calories, `${put?.data.calories} vs ${before.calories}`);
  ok('没顺手把开始时刻改回去(用户在运动页手动调过的不该被覆盖)', put?.data.startedAt === undefined);
  ok('服务端总共还是只有一条', allRows().length === 1, String(allRows().length));
  ok('那一条确实被改了(不是又写了一条旧的)', allRows()[0].durationMin === 70);
}

/* ================= ④ 改日期 ================= */
section('日志换了日期 → 那笔消耗跟着走,旧日期不留孤儿');
{
  const W = fresh({ weightKg: 70 });
  await W.syncWorkoutActivity(log({ date: '2026-10-15' }));
  ok('先落在 15 号', (serverByDate['2026-10-15'] ?? []).length === 1);
  // 用户在补录页把日期从 15 号改到 16 号
  const r = await W.syncWorkoutActivity(log({ date: '2026-10-16' }), { movedFrom: '2026-10-15' });
  ok('返回 updated(挪,不是新建)', r === 'updated', String(r));
  ok('新日期上有一条', (serverByDate['2026-10-16'] ?? []).length === 1);
  ok('**旧日期上那条没了**', (serverByDate['2026-10-15'] ?? []).length === 0, JSON.stringify(serverByDate['2026-10-15']));
  ok('总共仍然只有一条', allRows().length === 1, String(allRows().length));
}

/* ================= ⑤ 补写历史 ================= */
section('补写历史:以前练过的那几次也要进账');
{
  const W = fresh({ weightKg: 70 });
  const logs = [
    log({ id: 'wo-a', date: '2026-10-10' }),
    log({ id: 'wo-b', date: '2026-10-12' }),
    log({ id: 'wo-c', date: '2026-10-14', durationSec: 30 * 60 })
  ];
  const n = await W.backfillWorkoutEnergy(logs, { force: true });
  ok('三条都补上了', n === 3, String(n));
  ok('每条的消耗都挂在各自的日志 id 上', allRows().map((r) => r.externalId).sort().join() === 'wo-a,wo-b,wo-c', allRows().map((r) => r.externalId).join());
  ok('日期各归各位', (serverByDate['2026-10-10'] ?? []).length === 1 && (serverByDate['2026-10-12'] ?? []).length === 1 && (serverByDate['2026-10-14'] ?? []).length === 1);
  ok('30 分钟那条的消耗小于 45 分钟那条', (serverByDate['2026-10-14'][0].calories) < (serverByDate['2026-10-10'][0].calories));
  ok('补写也不算「用了运动功能」', !queued().includes('first_activity_log'), queued().join());
  // 再补一轮:能翻到旧日期,但没有一条该写
  const writesBefore = writes().length;
  const n2 = await W.backfillWorkoutEnergy(logs, { force: true });
  ok('再补一轮一条都不建', n2 === 0, String(n2));
  ok('再补一轮一个写请求都没有', writes().length === writesBefore, `多了 ${writes().length - writesBefore} 个`);
}

section('补写历史:本会话只跑一次');
{
  const W = fresh({ weightKg: 70 });
  const logs = [log({ id: 'wo-x', date: '2026-10-14' })];
  const n = await W.backfillWorkoutEnergy(logs);
  const readsBefore = calls.length;
  const n2 = await W.backfillWorkoutEnergy(logs);
  ok('第一次补了', n === 1, String(n));
  ok('第二次直接返回 0', n2 === 0, String(n2));
  ok('第二次连读请求都没发', calls.length === readsBefore, `多了 ${calls.length - readsBefore} 个`);
}

section('补写历史:「最近 N 天」是拿最新那条日志当锚,不是拿今天');
{
  const W = fresh({ weightKg: 70 });
  // 一个两个月没练的人打开训练页:要补的恰恰是两个月前那几次
  const logs = [
    log({ id: 'wo-old', date: '2026-08-01' }),
    log({ id: 'wo-old2', date: '2026-07-28' }),
    // 窗口是「最新那条往前 14 天」(2026-07-18 起),这条比它早三天
    log({ id: 'wo-ancient', date: '2026-07-15' })
  ];
  const n = await W.backfillWorkoutEnergy(logs, { force: true });
  ok('锚在最新那条日志上:两个月前那两次也补上了', n === 2, String(n));
  ok('真的落到 8 月 1 号那天了', (serverByDate['2026-08-01'] ?? []).length === 1);
  ok('**窗口外的那条不补**(不是「反正全补」)', (serverByDate['2026-07-15'] ?? []).length === 0);
  ok('窗口外那条也没为它发写请求', !writes().some((c) => c.data?.externalId === 'wo-ancient'));
}

section('补写历史:日期翻得太多要封顶(每个日期一次 GET)');
{
  const W = fresh({ weightKg: 70 });
  // 8 个不同的日期
  const logs = Array.from({ length: 8 }, (_, i) => log({ id: `wo-${i}`, date: `2026-10-${String(10 + i).padStart(2, '0')}` }));
  const n = await W.backfillWorkoutEnergy(logs, { force: true });
  const listCalls = calls.filter((c) => String(c.url).startsWith('/activities?')).length;
  ok('最多只翻 6 个日期', listCalls === 6, String(listCalls));
  ok('补的是最近的 6 天', n === 6, String(n));
  ok('最早那两天没被碰', (serverByDate['2026-10-10'] ?? []).length === 0 && (serverByDate['2026-10-11'] ?? []).length === 0);
}

/* ================= 跨午夜 ================= */
section('跨午夜:日志日期和真实开始时刻不在同一天');
{
  const W = fresh({ weightKg: 70 });
  // 16 号晚上练到 17 号凌晨才收工:日志算 16 号,开始时刻真实值落在 17 号
  await W.syncWorkoutActivity(log({ date: '2026-10-16' }), { startedAtMs: Date.parse('2026-10-17T00:20:00') });
  const post = calls.find((c) => c.method === 'POST');
  const at = new Date(post?.data.startedAt);
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  ok('消耗挂在日志那一天,不漂到第二天', day === '2026-10-16', day);
  ok('用当天中午兜底(不会在 16 号又凭空多出一次夜间运动)', at.getHours() === 12, String(at.getHours()));
}

/* ================= ⑥ 出错不挡路 ================= */
section('读不到体重:按默认估,而不是不写');
{
  const W = fresh(null);
  profileFails = true;
  const r = await W.syncWorkoutActivity(log());
  profileFails = false;
  const post = calls.find((c) => c.method === 'POST');
  ok('照样写了一条', r === 'created' && !!post, String(r));
  ok('按 65kg 估的那个数', post?.data.calories === Math.round((3.5 * 3.5 * 65 * 45) / 200), String(post?.data.calories));
}

section('写入失败:静默跳过,不抛');
{
  const W = fresh({ weightKg: 70 });
  postFails = true;
  let threw = false;
  let r;
  try { r = await W.syncWorkoutActivity(log()); } catch { threw = true; }
  postFails = false;
  ok('没有把异常抛给调用方(练完这一步不该被网络挡住)', !threw);
  ok('返回 skipped', r === 'skipped', String(r));
  ok('确实试着写过(这条用例不是「本来就没走到写」)', calls.some((c) => c.method === 'POST'));
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
