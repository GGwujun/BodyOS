/**
 * M7.1 训练数据上云 冒烟测试 —— 两台「设备」共用一个假云端,跑真实同步流水线。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-sync.mjs
 */
import { createRequire } from 'module';
import { join } from 'path';
const require = createRequire(import.meta.url);
const HERE = import.meta.dirname;

/* ---------------- mock Taro:存储按「设备」切换 ---------------- */
const devices = {};
let mem = (devices.A = new Map());
let nfc = 0;
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); },
  getFileSystemManager: () => ({
    readFile: ({ filePath, success }) => success({ data: `BASE64:${filePath}` })
  }),
  removeSavedFile: () => Promise.resolve({})
};
const taroMock = { default: storage, ...storage };
let CU;   // 后面才 require(它在 .smoke 里,得等 mock 装好)—— 先声明,免得 use() 早跑时踩进暂时性死区
/** 切设备。除换存储之外还要让 custom 的缓存重读一遍:它按引用缓存一份列表
 *  (真机上一次只有一台设备,不会错),而这里一个进程演两台机 */
const use = (name) => {
  mem = devices[name] ?? (devices[name] = new Map());
  CU?.saveCustom(mem.get('bodyos.training.custom') ?? null);
};

/* ---------------- mock 假云端(逐条 last-write-wins,和真服务端同规则) ---------------- */
const cloud = { docs: new Map(), media: [] };
let pushFails = 0;
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const trainingApi = {
  async pullDocs() {
    return { docs: [...cloud.docs.values()].map((d) => ({ ...d, payload: clone(d.payload) })), truncated: false };
  },
  async pushDocs(list) {
    if (pushFails > 0) { pushFails--; throw new Error('网络断了'); }
    let created = 0, updated = 0, kept = 0;
    const out = [];
    for (const d of list) {
      const key = `${d.kind}|${d.docKey}`;
      const cur = cloud.docs.get(key);
      if (!cur) { const row = { ...d, rev: 1 }; cloud.docs.set(key, row); created++; out.push(row); continue; }
      if (new Date(d.clientUpdatedAt).getTime() > new Date(cur.clientUpdatedAt).getTime()) {
        const row = { ...d, rev: cur.rev + 1 };
        cloud.docs.set(key, row); updated++; out.push(row);
      } else { kept++; out.push(cur); }
    }
    return { docs: out, created, updated, kept };
  },
  async uploadMedia(data, mime) {
    cloud.media.push({ data, mime });
    return { url: `/media/${cloud.media.length}.jpg`, bytes: data.length };
  }
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return taroMock;
  if (req === '@/services') return { trainingApi };
  // 编译产物里保留着 '@/' 别名,Node 认不出来,这里手动映射到 .smoke 目录
  if (req.startsWith('@/')) return origLoad.call(this, join(HERE, '..', '.smoke', req.slice(2)), ...rest);
  return origLoad.call(this, req, ...rest);
};

const ENGINE = '../.smoke/pkg-exercise/engine/';
const S = require(`${ENGINE}sync.js`);
const M = require(`${ENGINE}sync-merge.js`);
const Store = require(`${ENGINE}store.js`);

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const plan = (id, note = 'x') => ({
  id, createdAt: '2026-09-01T00:00:00.000Z', goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek: 3, sessionMin: 60, doneCount: 0, lastNote: note,
  days: [{ key: 'a', title: '全身 A', focus: '', estMin: 50, items: [] }]
});
const log = (id, date, extra = {}) => ({
  id, planId: 'p1', dayKey: 'a', dayTitle: '全身 A', date, durationSec: 3000,
  totalSets: 3, totalReps: 30, totalVolumeKg: 1000, avgRir: 2, entries: [], ...extra
});

/* ================= 合并规则(纯函数) ================= */
section('合并规则');
const d = (kind, docKey, payload, at) => ({ kind, docKey, payload, clientUpdatedAt: at });
const t = (h) => `2026-10-15T0${h}:00:00.000Z`;

{
  const r = M.mergeDocs(
    [d('plan', 'main', { v: 'phone' }, t(3))],
    [d('plan', 'main', { v: 'cloud' }, t(6))]
  );
  ok('云端更新 → 采纳云端那份', r.docs[0].payload.v === 'cloud' && r.fromRemote === 1);
}
{
  const r = M.mergeDocs(
    [d('plan', 'main', { v: 'phone' }, t(7))],
    [d('plan', 'main', { v: 'cloud' }, t(6))]
  );
  ok('本机更新 → 保留本机那份', r.docs[0].payload.v === 'phone' && r.fromLocal === 1);
}
{
  const r = M.mergeDocs(
    [d('kit', 'main', { v: 'phone' }, t(4))],
    [d('kit', 'main', { v: 'cloud' }, t(4))]
  );
  ok('时间戳相同 → 以云端为准(和服务端同规则,反复同步才收敛)', r.docs[0].payload.v === 'cloud');
}
{
  const r = M.mergeDocs(
    [d('logs', 'wo-1', { id: 'wo-1' }, t(1))],
    [d('logs', 'wo-1', { id: 'wo-1' }, t(1)), d('logs', 'wo-2', { id: 'wo-2' }, t(2))]
  );
  ok('日志按 id 取并集:云端多出来的补进来', r.docs.length === 2 && r.docs.some((x) => x.docKey === 'wo-2'));
}
{
  const docs = [
    d('plan', 'main', {}, t(9)), d('progress', 'main', {}, t(9)),
    d('logs', 'a', {}, t(1)), d('logs', 'b', {}, t(2)), d('logs', 'c', {}, t(3))
  ];
  const capped = M.capDocs(docs, 2, ['logs']);
  ok('裁日志只留最新的 N 条', capped.filter((x) => x.kind === 'logs').map((x) => x.docKey).sort().join() === 'b,c');
  ok('单例文档永远不裁(否则会把计划删掉)', capped.some((x) => x.kind === 'plan'));
}

/* ================= 端到端:两台设备 ================= */
section('第一次同步(设备 A 有数据,云端空)');
use('A');
Store.savePlan(plan('p1', '第一版'));
Store.saveProgress({ '0025': { exerciseId: '0025', weightKg: 60, repsMin: 8, repsMax: 12, successStreak: 1, failStreak: 0, suggestion: null, updatedAt: '2026-10-01T00:00:00.000Z' } });
Store.appendLog(log('wo-1', '2026-10-13'));
Store.appendLog(log('wo-2', '2026-10-14'));
Store.setNote('0025', '左肩不适,重量减一档');
const K = require(`${ENGINE}kit.js`);
K.saveKit({ plates: { 25: 2 }, dumbbells: [10, 14] });
const MX = require(`${ENGINE}max.js`);
MX.setMax('0025', '杠铃卧推', 72.5);
const P = require('../.smoke/utils/photos.js');
P.savePhotos([{ id: 'ph-1', date: '2026-10-01', pose: 'front', path: 'wxfile://a.jpg' }]);

const r1 = await S.syncNow();
// 计划 + 渐进 + 备注 + 器材 + 力量基准 + 2 条日志 + 照片索引 = 8
ok('A 首次同步:云端新建了全部文档', r1.created === 8, `created=${r1.created}`);
ok('A 首次同步没有回拉(云端本来是空的)', r1.pulled === 0 && r1.adopted === 0);
ok('同步成功后记下「上次同步」时间', !!S.lastSyncedAt());
ok('云端有了 8 条文档', cloud.docs.size === 8, `size=${cloud.docs.size}`);
ok('照片传上去了,并记下云端地址', cloud.media.length === 1 && P.loadPhotos()[0].url === '/media/1.jpg');

section('第二次同步要收敛(不能反复推同一份)');
const before = JSON.stringify([...cloud.docs.values()].map((x) => x.rev));
const r2 = await S.syncNow();
const after = JSON.stringify([...cloud.docs.values()].map((x) => x.rev));
ok('再同步一次:没有新建也没有覆盖', r2.created === 0 && r2.updated === 0 && r2.kept === 8, JSON.stringify(r2).slice(0, 90));
ok('云端 rev 一个都没涨(收敛了)', before === after);
ok('照片不会重复上传', cloud.media.length === 1);

section('设备 B 换机:第一次同步把数据拉回来');
use('B');
ok('B 本机是空的', !Store.loadPlan() && Store.loadLogs().length === 0);
const r3 = await S.syncNow();
ok('B 拉回了计划', Store.loadPlan()?.id === 'p1');
ok('B 拉回了渐进状态', Store.loadProgress()['0025']?.weightKg === 60);
ok('B 拉回了两条日志', Store.loadLogs().map((l) => l.id).sort().join() === 'wo-1,wo-2');
ok('B 拉回了器材', K.loadKit().dumbbells.join() === '10,14');
ok('B 拉回了手填的力量基准', MX.loadMaxes()['0025']?.tmKg === 72.5 && MX.loadMaxes()['0025']?.source === 'manual');
ok('B 拉回了动作备注', Store.loadNotes()['0025'].includes('左肩'));
ok('B 拉回了照片索引,但没有本机文件', P.loadPhotos()[0]?.url === '/media/1.jpg' && !P.loadPhotos()[0]?.path);
ok('B 没把空数据推上去覆盖云端', Store.loadPlan()?.lastNote === '第一版');
ok('B 这次同步「从云端补回来」的条数被算出来', r3.pulled >= 5, `pulled=${r3.pulled}`);

section('两岸各自练:日志取并集,谁都不丢');
use('A');
Store.appendLog(log('wo-3', '2026-10-15'));
await S.syncNow();
use('B');
Store.appendLog(log('wo-4', '2026-10-15', { durationSec: 2400 }));
await S.syncNow();
use('A');
await S.syncNow();
ok('A 拿到了 B 练的那次', Store.loadLogs().some((l) => l.id === 'wo-4'));
ok('A 本机两次都还在', Store.loadLogs().some((l) => l.id === 'wo-3'));
use('B');
await S.syncNow();
ok('B 也拿到了 A 练的那次', Store.loadLogs().some((l) => l.id === 'wo-3'));
ok('两台设备的日志集合一致', hasSameLogs(devices.A, devices.B));

section('同一条日志两边都改:后改的赢(不是后同步的赢)');
// 时间戳只到毫秒,脚本跑太快两次修改会落在同一毫秒里(那是「平局」,不是「后改的赢」)。
// 真人是几秒几十秒的间隔,这里睡几毫秒把顺序摆出来。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
use('B');
await sleep(5);
Store.updateLog('wo-1', { note: 'B 改的' });
await S.syncNow();
use('A');
await S.syncNow();
ok('A 变成 B 改过的版本', Store.loadLogs().find((l) => l.id === 'wo-1')?.note === 'B 改的');
use('A');
await sleep(5);
Store.updateLog('wo-1', { note: 'A 后改的' });
await S.syncNow();
use('B');
await S.syncNow();
ok('B 又变成 A 后改的版本', Store.loadLogs().find((l) => l.id === 'wo-1')?.note === 'A 后改的');

section('计划在 A 上删掉,B 同步后也没了');
use('A');
Store.clearPlan();
await S.syncNow();
ok('A 本机计划已删', !Store.loadPlan());
ok('云端记的是「已删除」占位,不是把文档删了', S.isDeleted(cloud.docs.get('plan|main')?.payload));
use('B');
ok('B 同步前还有计划', !!Store.loadPlan());
await S.syncNow();
ok('B 同步后计划也没了(删除动作被带过去)', !Store.loadPlan());
use('B');
await S.syncNow();
ok('再同步一次不会把计划又拉回来', !Store.loadPlan());

section('网络断了:本机数据一条都不许动');
use('B');
Store.setNote('0652', '引体向上用弹力带');
pushFails = 99;
const rFail = await S.syncNow();
ok('失败的批次被记下来', rFail.failed > 0, `failed=${rFail.failed}`);
ok('本机备注还在(没被回滚)', Store.loadNotes()['0652'].includes('弹力带'));
ok('本机日志也不受影响', Store.loadLogs().length === 4);
pushFails = 0;
const rOk = await S.syncNow();
ok('网络恢复后补传成功', rOk.failed === 0 && rOk.created + rOk.updated > 0);
use('A');
await S.syncNow();
ok('A 收到了 B 断网时写的备注', (Store.loadNotes()['0652'] ?? '').includes('弹力带'));

section('请假条和收藏也跟着上云(M10.1 / M10.2)');
// 这两样都是「告诉应用别催我 / 我常做这几个」的个人设置。换手机丢掉的后果不是少一条记录,
// 而是新设备上重新开始催一个还在外地的人 —— 所以必须跟着同步。
const D = require(`${ENGINE}daynote.js`);
const FA = require(`${ENGINE}fav.js`);
use('A');
D.setDayNote({}, '2026-10-15', 'travel', '在外地出差', '2026-10-15');
FA.saveFavs(['0025', '0652']);
await S.syncNow();
use('B');
await S.syncNow();
ok('B 拉回了请假条', D.loadDayNotes()['2026-10-15']?.kind === 'travel', JSON.stringify(D.loadDayNotes()['2026-10-15']));
ok('B 拉回了收藏', FA.loadFavs().join() === '0025,0652', FA.loadFavs().join());

section('B 上销假 / 取消收藏,也传播得回去(删空同样得推)');
use('B');
// 这里也必须睡一下:修改时间只到毫秒,脚本跑得比时钟快,B 的改动会和 A 的落在同一毫秒里 ——
// 那是「平局」(服务端保留云端那份),不是「后改的赢」,真人是几秒几十秒的间隔。
await sleep(5);
D.saveDayNotes(D.clearDayNote(D.loadDayNotes(), '2026-10-15'));
FA.saveFavs([]);   // 关键的边界:数组清空后本地「没有内容」,只有修改时间这一个信号能把它推出去
await S.syncNow();
use('A');
await S.syncNow();
ok('A 上请假条被销掉了', Object.keys(D.loadDayNotes()).length === 0, JSON.stringify(D.loadDayNotes()));
ok('A 上收藏也清空了(空数组没被「跳过不推」吃掉)', FA.loadFavs().length === 0, JSON.stringify(FA.loadFavs()));

section('自定义动作也跟着上云(M10.12)');
// 用户自己建的动作只和他自己的设备有关,但**必须跟着走**:换手机之后,老计划、历史记录里
// 那些 c- 开头的 id 全都要认得出名字、器械、肌群 —— 不只是「挑动作时看得到」。
CU = require(`${ENGINE}custom.js`);
/** 换到某台设备上看它自己的自定义动作(use 里已经把缓存换成那台的了) */
const customOn = (dev) => { use(dev); return CU.allCustom(); };
use('A');
const mine = CU.addCustom({ name: '我的推胸机', bodyPart: 'chest', equipment: 'leverage machine', target: 'chest', secondary: ['shoulders'] });
ok('A 上建好了', mine.ok && CU.listCustom().length === 1);
await S.syncNow();
use('B');
await S.syncNow();
ok('B 拉回了同一个动作(同一个 id —— 计划里的引用才不会断)',
  customOn('B').some((c) => c.id === mine.ex.id && c.name === '我的推胸机'),
  customOn('B').map((c) => c.id).join());
ok('B 上连肌群/单侧这些口径也一并有了(不是只搬了个名字)',
  CU.findCustom(mine.ex.id).target === 'chest' && CU.findCustom(mine.ex.id).secondary.join() === 'shoulders');

section('在一台上删掉的动作,另一台上也不再出现(但记录还留着)');
use('B');
// 必须睡一下:修改时间只到毫秒,脚本跑得比时钟快,两次改动会落在同一毫秒里
await sleep(5);
CU.retireCustom(mine.ex.id);
await S.syncNow();
use('A');
await S.syncNow();
const backOnA = customOn('A');
ok('A 上它从「能挑的」里消失了', CU.listCustom().length === 0);
ok('但退场记录也传过来了(另一台不会把它当成「从没建过」)', backOnA.some((c) => c.id === mine.ex.id && !!c.deletedAt));
ok('历史里的 id 照样认得出名字(肌群统计/详情页不会掉成裸编号)',
  (CU.findCustom(mine.ex.id) ?? {}).name === '我的推胸机');

section('⑧ 手改时长:只动时长那一格,别的原样,而且要传到另一台');
// 训练计时是墙钟算的,被打断那次会虚高 —— 完成汇总页给了一个只改 `durationSec` 的出口。
// 这里盯的是那个出口的两个承诺:①碰不到组数/次数/重量/备注 ②不是「本机私有」的改动。
const DU = require('../.smoke/utils/duration.js');
use('A');
// 先给这条日志填一组真实的组明细:脚本里初始那条是个空壳(entries: []),
// 拿空数组去比「组明细有没有被抹掉」是比不出来的(两边都是空)
Store.updateLog('wo-1', {
  entries: [{ exerciseId: '0025', nameZh: '杠铃卧推', sets: [{ reps: 8, weightKg: 60, done: true, rir: 2 }] }]
});
await sleep(5);
const beforeDur = Store.loadLogs().find((l) => l.id === 'wo-1');
ok('改之前:这条是练完当场记的(不是补录)', !!beforeDur && !beforeDur.manual);
/** 除时长以外**所有**该原样保留的格子,改完逐字节比一遍 */
const kept = JSON.stringify({
  date: beforeDur.date, dayKey: beforeDur.dayKey, dayTitle: beforeDur.dayTitle,
  entries: beforeDur.entries, totalSets: beforeDur.totalSets, totalReps: beforeDur.totalReps,
  totalVolumeKg: beforeDur.totalVolumeKg, manual: !!beforeDur.manual, note: beforeDur.note ?? null
});
await sleep(5);
Store.updateLog('wo-1', { durationSec: DU.spanSeconds(45) });
const afterDur = Store.loadLogs().find((l) => l.id === 'wo-1');
ok('45 分钟落盘成 2700 秒', afterDur.durationSec === 2700, String(afterDur.durationSec));
ok('组数/次数/重量/备注/训练日一格没动(改时长不是改战绩)', JSON.stringify({
  date: afterDur.date, dayKey: afterDur.dayKey, dayTitle: afterDur.dayTitle,
  entries: afterDur.entries, totalSets: afterDur.totalSets, totalReps: afterDur.totalReps,
  totalVolumeKg: afterDur.totalVolumeKg, manual: !!afterDur.manual, note: afterDur.note ?? null
}) === kept);
ok('没被顺手打成「补录」(打了的话这次成绩就从纪录榜和力量基准里消失了)', !afterDur.manual);
ok('组明细一組没丢(entries 被抹掉的话历史与曲线整条都空了)',
  afterDur.entries.length === 1 && afterDur.entries[0].sets.length === 1
  && afterDur.entries[0].sets[0].weightKg === 60);
await S.syncNow();
use('B');
await S.syncNow();
ok('B 那台也拿到改完的时长', Store.loadLogs().find((l) => l.id === 'wo-1')?.durationSec === 2700,
  String(Store.loadLogs().find((l) => l.id === 'wo-1')?.durationSec));
ok('B 上其它格子也没被这次改动带偏',
  (Store.loadLogs().find((l) => l.id === 'wo-1')?.totalVolumeKg) === beforeDur.totalVolumeKg);

section('老数据(功能上线前存的,没有修改时间)');
ok('没记过修改时间的当最旧:不会覆盖云端更新的那份', (() => {
  const r = M.mergeDocs([d('kit', 'main', { v: 'old' }, new Date(0).toISOString())], [d('kit', 'main', { v: 'new' }, t(5))]);
  return r.docs[0].payload.v === 'new';
})());

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);

function hasSameLogs(a, b) {
  const ids = (m) => (m.get('bodyos.training.logs') ?? []).map((l) => l.id).sort().join();
  return ids(a) === ids(b);
}
