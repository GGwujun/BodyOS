/**
 * M7.2 导出/备份 冒烟测试 —— 导出 → 文本 → 解析 → 导入,两台「设备」之间来回搬。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-backup.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* ---------------- mock Taro:存储按「设备」切换 ---------------- */
const devices = {};
let mem = (devices.A = new Map());
const files = [];
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); },
  env: { USER_DATA_PATH: 'wxfile://usr' },
  getFileSystemManager: () => ({
    writeFile: ({ filePath, data, success }) => { files.push([filePath, data]); success?.({ errMsg: 'writeFile:ok' }); }
  })
};
const taroMock = { default: storage, ...storage };
/** 切设备。除换存储之外还要让 custom 的缓存重读一遍:它按引用缓存一份列表
 *  (真机上一次只有一台设备,不会错),而这里一个进程演两台机 */
const use = (name) => {
  mem = devices[name] ?? (devices[name] = new Map());
  CU.saveCustom(mem.get('bodyos.training.custom') ?? null);
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return taroMock;
  return origLoad.call(this, req, ...rest);
};

const ENGINE = '../.smoke/pkg-exercise/engine/';
const B = require(`${ENGINE}backup.js`);
const Store = require(`${ENGINE}store.js`);
const K = require(`${ENGINE}kit.js`);
const MX = require(`${ENGINE}max.js`);
const CU = require(`${ENGINE}custom.js`);
const P = require('../.smoke/utils/photos.js');
/** 换到某台设备上看它自己的自定义动作(use 里已经把缓存换成那台的了) */
const customOn = (dev) => { use(dev); return CU.allCustom(); };

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const plan = (id, note) => ({
  id, createdAt: '2026-09-01T00:00:00.000Z', goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek: 3, sessionMin: 60, doneCount: 2, lastNote: note,
  days: [{ key: 'a', title: '全身 A', focus: '', estMin: 50, items: [] }]
});
const log = (id, date, note) => ({
  id, planId: 'p1', dayKey: 'a', dayTitle: '全身 A', date, durationSec: 3000,
  totalSets: 3, totalReps: 30, totalVolumeKg: 1000, avgRir: 2, note, entries: []
});

/* ================= 导出 ================= */
section('导出');
use('A');
ok('空机导出:没有东西可导', !B.hasAnything(B.buildBundle()));

Store.savePlan(plan('p1', '第一版'));
Store.saveProgress({ '0025': { exerciseId: '0025', weightKg: 60, repsMin: 8, repsMax: 12, successStreak: 1, failStreak: 0, suggestion: null, updatedAt: '2026-10-01T00:00:00.000Z' } });
Store.appendLog(log('wo-1', '2026-10-13', '腿有点酸'));
Store.appendLog(log('wo-2', '2026-10-14', ''));
Store.setNote('0025', '左肩不适,重量减一档');
K.saveKit({ plates: { 25: 2 }, dumbbells: [10, 14] });
// 存了两套器材(「家里」那套不一样),再把常用的切回来 —— 导出的必须是**整份**,
// 只导当前那套的话,换台设备那几套就被悄悄压成一套了(而且不报错)
K.addProfile('家里');
K.saveKit({ plates: { 10: 1 } });
K.switchProfile(K.listProfiles()[0].id);
MX.setMax('0025', '杠铃卧推', 72.5);
P.savePhotos([{ id: 'ph-1', date: '2026-10-01', pose: 'front', path: 'wxfile://a.jpg', url: '/media/1.jpg' }]);
// 自定义动作是**用户自己写的东西**,和照片一样属于「换手机就没了」的那一类
const myEx = CU.addCustom({ name: '我的推胸机', bodyPart: 'chest', equipment: 'leverage machine', target: 'chest', secondary: ['shoulders'] });
if (!myEx.ok) throw new Error(`建动作失败:${myEx.why}`);

const bundle = B.buildBundle();
const counts = B.countsOf(bundle);
ok('导出数出计划 1 份', counts.plan === 1);
ok('导出数出 2 次训练', counts.logs === 2);
ok('导出数出 1 条备注', counts.notes === 1);
ok('导出数出器材清单', counts.kit === 1);
ok('器材导的是整份(两套 + 哪套在用)', bundle.kit.list.length === 2 && bundle.kit.current === K.currentProfileId(),
  `两套=${bundle.kit.list.map((p) => p.name).join('/')}`);
ok('导出数出力量基准', counts.maxes === 1);
ok('导出数出照片记录', counts.photos === 1);
ok('导出数出我自己建的动作', counts.custom === 1 && bundle.custom[0].id === myEx.ex.id);
ok('有东西可导', B.hasAnything(bundle));
ok('照片只导索引,不带本机文件路径', bundle.photos[0].path === undefined && bundle.photos[0].url === '/media/1.jpg');

const text = B.bundleText(bundle);
ok('文本带抬头标记', text.startsWith(B.BACKUP_HEAD));
ok('文本就是人能读的 JSON', (() => {
  try { JSON.parse(text.slice(B.BACKUP_HEAD.length + 1)); return true; } catch { return false; }
})());

/* ================= 解析 ================= */
section('解析(粘回来的东西什么样都可能)');
ok('原样能解析', B.parseBundle(text).ok);
ok('前后有空白也能解析', B.parseBundle(`\n  ${text}  \n`).ok);
ok('被聊天软件加了引号也能解析', B.parseBundle(`"${text}"`).ok);
ok('抬头丢了、只剩 JSON 也能解析', B.parseBundle(text.slice(B.BACKUP_HEAD.length + 1)).ok);
ok('空文本给出人话提示', B.parseBundle('   ').error === '先粘贴备份文本');
ok('粘了半截(被截断)会说出来', B.parseBundle(`${text.slice(0, 80)}`).ok === false);
ok('粘的是别的东西 → 认不出来', B.parseBundle('今天练得不错').error.includes('不是备份'));
ok('JSON 但格式不对 → 认不出来', B.parseBundle('{"hello":"world"}').error.includes('版本'));
ok('来自更新版本的备份 → 让人先升级', (() => {
  const newer = JSON.stringify({ ...bundle, v: 99 });
  return B.parseBundle(newer).error.includes('更新版本');
})());
ok('版本正确但里面什么都没有 → 也算没内容', (() => {
  const empty = JSON.stringify({ v: 1, at: '', logs: [], notes: {} });
  return B.parseBundle(empty).error.includes('没有训练数据');
})());
ok('脏的自定义动作(部位/器械认不出来)被丢掉,好的留下', (() => {
  const dirty = JSON.stringify({
    v: 1, at: '', custom: [
      { id: 'c-1', name: '好的', bodyPart: 'chest', equipment: 'barbell' },
      { id: 'c-2', name: '坏部位', bodyPart: '外星部位', equipment: 'barbell' },
      { id: 'c-3', name: '坏器械', bodyPart: 'chest', equipment: '外星器械' },
      { id: 'c-4', name: '', bodyPart: 'chest', equipment: 'barbell' }
    ]
  });
  const r = B.parseBundle(dirty);
  return r.ok && r.bundle.custom.length === 1 && r.bundle.custom[0].name === '好的';
})());
ok('脏日志(缺 id/日期)被丢掉', (() => {
  const dirty = JSON.stringify({ v: 1, at: '', logs: [{ id: 'x' }, { date: '2026-01-01' }, { id: 'wo-9', date: '2026-01-01' }] });
  const r = B.parseBundle(dirty);
  return r.ok && r.bundle.logs.length === 1;
})());

/* ================= 导入:换机 ================= */
section('换机:把 A 的备份导进空的 B');
use('B');
// B 上也建过一个**同名**的(不同 id)—— 用来钉「按 id 取并集,不按名字合并」
const ownEx = CU.addCustom({ name: '我的推胸机', bodyPart: 'back', equipment: 'cable' });
const r1 = B.applyBundle(B.parseBundle(text).bundle);
ok('补齐了计划', r1.plan && Store.loadPlan()?.lastNote === '第一版');
ok('补齐了两条日志', Store.loadLogs().length === 2 && Store.loadLogs()[0].id === 'wo-2');
ok('补齐了备注', Store.loadNotes()['0025'].includes('左肩'));
ok('补齐了器材', K.loadKit().dumbbells.join() === '10,14');
ok('几套器材一起回来了(不是只剩当前那套)', K.listProfiles().map((p) => p.name).join() === '我常用的,家里',
  K.listProfiles().map((p) => p.name).join());
ok('「哪套在用」也跟着回来', K.currentProfileId() === K.listProfiles()[0].id && K.loadKit().plates['25'] === 2);
ok('补齐了力量基准(手填的仍是 manual)', MX.loadMaxes()['0025'].source === 'manual');
ok('补齐了照片记录', P.loadPhotos()[0]?.url === '/media/1.jpg');
ok('日志按日期倒序(最新在前)', Store.loadLogs()[0].date === '2026-10-14');
ok('导入不会凭空多算', r1.logsAdded === 2 && r1.notesAdded === 1);
ok('补齐了我自己建的动作(同一个 id,老计划里的引用接得上)', r1.customAdded === 1, `customAdded=${r1.customAdded}`);
ok('补进来的那条就是 A 上建的那条', CU.findCustom(myEx.ex.id)?.target === 'chest' && CU.findCustom(myEx.ex.id).name === '我的推胸机');
ok('同名不同 id 的两条不合并(名字能重见,id 不会)', CU.allCustom().length === 2, String(CU.allCustom().length));

/* ================= 导入:合并不覆盖 ================= */
section('导入到已有数据的设备:只补缺的,不动现有的');
use('B');
Store.savePlan(plan('p2', '我自己现在的计划'));
Store.appendLog(log('wo-3', '2026-10-15', 'B 自己练的'));
Store.setNote('0652', '引体用弹力带');
Store.saveProgress({ '0652': { exerciseId: '0652', weightKg: null, repsMin: 6, repsMax: 10, successStreak: 0, failStreak: 0, suggestion: null, updatedAt: '2026-10-15T00:00:00.000Z' } });
const r2 = B.applyBundle(B.parseBundle(text).bundle);
ok('本机自己建的那条留着(定名册上是我自己那份)', CU.allCustom().some((c) => c.id === ownEx.ex.id));
ok('备份里那条已经在的不重复补一遍', r2.customAdded === 0, `customAdded=${r2.customAdded}`);
ok('本机自己的计划没被换掉', Store.loadPlan()?.id === 'p2' && !r2.plan);
ok('本机已有的日志一条不少', Store.loadLogs().length === 3);
ok('重复的日志不会被导成两份', r2.logsAdded === 0, `logsAdded=${r2.logsAdded}`);
ok('本机自己的备注保留', Store.loadNotes()['0652'].includes('弹力带'));
ok('本机没有的备注才补进来', r2.notesAdded === 0, `notesAdded=${r2.notesAdded}`);
ok('渐进状态没被覆盖(0652 还是我这份)', Store.loadProgress()['0652']?.repsMin === 6);

section('导入:只有一条不同,其余相同');
use('B');
Store.saveLogs(Store.loadLogs().filter((l) => l.id !== 'wo-1'));
const r3 = B.applyBundle(JSON.parse(JSON.stringify(B.parseBundle(text).bundle)));
ok('只补回缺的那一条', r3.logsAdded === 1 && Store.loadLogs().some((l) => l.id === 'wo-1'));
ok('其它日志没有重复', Store.loadLogs().filter((l) => l.id === 'wo-2').length === 1);

/* ================= 导入:整份覆盖 ================= */
section('「整份覆盖」是明确选过的动作');
use('B');
Store.savePlan(plan('p3', '要被覆盖掉的'));
B.applyBundle(B.parseBundle(text).bundle, 'replace');
ok('计划被替换成备份里的', Store.loadPlan()?.id === 'p1');
ok('日志被替换成备份里的两条', Store.loadLogs().length === 2);
ok('覆盖模式下本机多出来的备注被清掉', Store.loadNotes()['0652'] === undefined);
ok('覆盖模式下本机自己建的动作也换成了备份里那份',
  customOn('B').length === 1 && CU.allCustom()[0].id === myEx.ex.id, customOn('B').map((c) => c.id).join());
ok('备份里的备注还在', Store.loadNotes()['0025'].includes('左肩'));

/* ================= 导出 → 导入 往返一致 ================= */
section('往返一致(导出的东西导回来还是那些)');
use('A');
const once = B.bundleText(B.buildBundle());
use('C');
B.applyBundle(B.parseBundle(once).bundle);
const twice = B.bundleText(B.buildBundle());
const strip = (t) => {
  const b = JSON.parse(t.slice(B.BACKUP_HEAD.length + 1));
  delete b.at;                 // 导出时间每次都不同,不比它
  if (b.photos) b.photos = b.photos.map((p) => ({ ...p, path: undefined }));
  return JSON.stringify(b);
};
ok('A → C 的内容一模一样', strip(once) === strip(twice));

/* ================= 老备份(器材那一格还是裸的 Kit) ================= */
section('老备份:器材那一格还是裸的 Kit');
use('D');
const legacyText = JSON.stringify({ v: 1, at: '', kit: { plates: { 25: 2 }, dumbbells: [10, 14] }, logs: [log('wo-9', '2026-10-10', '')] });
const legacyBundle = B.parseBundle(legacyText).bundle;
ok('老备份里的裸 Kit 认得出有器材', B.countsOf(legacyBundle).kit === 1);
const rl = B.applyBundle(legacyBundle);
ok('裸 Kit 导进来 → 就地包成一套', rl.kit && K.listProfiles().length === 1 && K.loadKit().dumbbells.join() === '10,14');
ok('那套有个能认的名字', K.profileName() === K.LEGACY_PROFILE_NAME, K.profileName());
// 「只登记了片」也是登记过 —— 以前 plates 用 .length 数,这种备份会被整个判成「没有训练数据」,
// 用户粘回自己的备份反而被拒(冒烟逮到过)
ok('只有片库存的备份不算「没有训练数据」', B.parseBundle(JSON.stringify({ v: 1, at: '', kit: { plates: { 25: 2 } } })).ok);
ok('只有杆重的也算', B.parseBundle(JSON.stringify({ v: 1, at: '', kit: { bars: { barbell: 15 } } })).ok);

/* ================= 存文件 ================= */
section('存成文件');
const p = await B.saveToFile(text);
ok('写出了文件', files.length === 1 && p.endsWith('.txt'));
ok('写进去的就是备份文本', files[0][1] === text);

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
