/**
 * M4.2 进度照片 冒烟测试
 * 用法:
 *   npx tsc src/utils/photos.ts --outDir .smoke --module commonjs --target es2019 \
 *     --esModuleInterop --skipLibCheck --moduleResolution node
 *   node scripts/smoke-photos.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* ---- mock Taro:内存存储 + 可控的 saveFile ---- */
const mem = new Map();
const removed = [];
let saveImpl = async ({ tempFilePath }) => ({ savedFilePath: `store://${tempFilePath}` });
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); },
  saveFile: (o) => saveImpl(o),
  removeSavedFile: (o) => { removed.push(o.filePath); return Promise.resolve({}); }
};
const taroMock = { default: storage, ...storage };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return taroMock;
  return origLoad.call(this, req, ...rest);
};

const P = require('../.smoke/utils/photos.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const ph = (date, pose, path = `wx://${date}-${pose}.jpg`) => ({ id: `ph-${path}`, date, pose, path });

/* ================= 排序 / 分组 ================= */
const list = [
  ph('2026-08-01', 'front'),
  ph('2026-09-15', 'front'),
  ph('2026-10-14', 'front'),
  ph('2026-09-20', 'side'),
  ph('2026-10-01', 'back')
];
ok('新的在前', P.sortDesc(list).map((p) => p.date).join(',') === '2026-10-14,2026-10-01,2026-09-20,2026-09-15,2026-08-01');
ok('按姿势筛选', P.photosOf(list, 'front').map((p) => p.date).join(',') === '2026-10-14,2026-09-15,2026-08-01');
ok('按姿势计数', P.countOf(list, 'front') === 3 && P.countOf(list, 'side') === 1);
ok('没有的姿势计数为 0', P.countOf(list, 'back') === 1 && P.countOf([], 'front') === 0);
ok('不修改原数组', (() => { const before = list.map((p) => p.date).join(); P.sortDesc(list); return list.map((p) => p.date).join() === before; })());

const months = P.byMonth(list);
ok('按月分组,新的月份在前', months.map((m) => m.month).join(',') === '2026-10,2026-09,2026-08');
ok('同月的照片归到一组', months[1].items.length === 2, JSON.stringify(months[1].items.map((p) => p.date)));
ok('月份标签好读', P.monthLabel('2026-08') === '2026 年 8 月', P.monthLabel('2026-08'));

/* ================= 默认对比 ================= */
const pair = P.defaultPair(list, 'front');
ok('默认拿最早和最晚比', pair.before.date === '2026-08-01' && pair.after.date === '2026-10-14',
  `${pair.before.date} → ${pair.after.date}`);
ok('只有一个姿势只有一张时前后是同一张', (() => {
  const p = P.defaultPair([ph('2026-10-14', 'back')], 'back');
  return p.before.id === p.after.id && P.samePair(p.before, p.after);
})());
ok('空列表返回 null', P.defaultPair([], 'front').before === null);
ok('同一天拍的两张是两张', !P.samePair(ph('2026-10-14', 'front', 'a'), ph('2026-10-14', 'front', 'b')));

/* ================= 天数 ================= */
ok('天数差算得对', P.dayGap(ph('2026-08-01', 'front'), ph('2026-10-14', 'front')) === 74,
  String(P.dayGap(ph('2026-08-01', 'front'), ph('2026-10-14', 'front'))));
ok('缺一张算不出', P.dayGap(null, ph('2026-10-14', 'front')) === null);
ok('少于一周按天说', P.gapText(3) === '相隔 3 天');
ok('几周按周说', P.gapText(42) === '相隔 6 周');
ok('几十天按周说', P.gapText(59) === '相隔 8 周');
ok('两个月以上按月说', P.gapText(74) === '相隔 2 个月', P.gapText(74));
ok('同一天拍的给出实话', /同一天/.test(P.gapText(0)));
ok('算不出天数时不说话', P.gapText(null) === '');

/* ================= 时间线文案 ================= */
ok('第一张标出来', P.ageOf(list, ph('2026-08-01', 'front')) === '第一张',
  P.ageOf(list, ph('2026-08-01', 'front')));
ok('后面的照片标 +N 天', P.ageOf(list, ph('2026-09-15', 'front')) === '+45 天',
  P.ageOf(list, ph('2026-09-15', 'front')));
ok('不同姿势各算各的', P.ageOf(list, ph('2026-09-20', 'side')) === '第一张');
ok('不在列表里的照片不报错', P.ageOf([], ph('2026-09-20', 'side')) === '第一张');

/* ================= 存取(走 mock 的 Taro) ================= */
(async () => {
  ok('初始没有照片', P.loadPhotos().length === 0);

  const e1 = await P.addPhoto('tmp/1.jpg', 'front', '2026-08-01');
  ok('存照片返回持久路径', e1.path === 'store://tmp/1.jpg', e1.path);
  ok('存完能读回来', P.loadPhotos().length === 1 && P.loadPhotos()[0].pose === 'front');

  await P.addPhoto('tmp/2.jpg', 'front', '2026-10-14');
  ok('多次添加按日期倒序', P.loadPhotos().map((p) => p.date).join(',') === '2026-10-14,2026-08-01');

  // 同一毫秒连存两张:时间戳撞了、id 不能撞(撞了删一张会连带删掉另一张)
  const same1 = await P.addPhoto('tmp/3.jpg', 'side', '2026-01-01');
  const same2 = await P.addPhoto('tmp/4.jpg', 'side', '2026-01-01');
  ok('同一时刻连存两张 id 不重复', same1.id !== same2.id, `${same1.id} vs ${same2.id}`);
  const afterSame = P.loadPhotos();
  const restSame = P.removePhoto(same1.id);
  ok('删其中一张不会连带删掉另一张', restSame.length === afterSame.length - 1
    && restSame.some((p) => p.id === same2.id), `${afterSame.length} → ${restSame.length}`);

  // 存不下的时候要说人话
  const good = saveImpl;
  saveImpl = async () => { throw { errMsg: 'saveFile:fail the maximum size of the file storage limit is exceeded' }; };
  let msg = '';
  try { await P.addPhoto('tmp/3.jpg', 'front', '2026-10-20'); } catch (err) { msg = err.message; }
  ok('空间满了给的是人话', /满了/.test(msg) && !/errMsg/.test(msg), msg);
  const before = P.loadPhotos().length;
  ok('存失败不会留下半条记录', before === 3, String(before));

  saveImpl = async () => { throw { errMsg: 'saveFile:fail some other reason' }; };
  msg = '';
  try { await P.addPhoto('tmp/4.jpg', 'front', '2026-10-21'); } catch (err) { msg = err.message; }
  ok('其它失败也给中文提示', msg === '照片保存失败,请再试一次', msg);
  saveImpl = good;

  // 删除
  const target = P.loadPhotos()[0];
  const rest = P.removePhoto(target.id);
  ok('删除后列表少一条', rest.length === 2 && rest[0].date === '2026-08-01');
  ok('删除会连本地文件一起清', removed.includes(target.path), removed.join(','));
  ok('删不存在的 id 不报错', P.removePhoto('nope').length === 2);

  // 存储里混进脏数据
  mem.set('bodyos.photos', [null, { date: '2026-01-01' }, { path: 'x' }, { date: '2026-01-01', pose: 'nope', path: 'x' }, rest[0]]);
  ok('脏数据不会带崩页面', P.loadPhotos().length === 1);
  mem.set('bodyos.photos', 'not-an-array');
  ok('存储被写坏时返回空数组', P.loadPhotos().length === 0);

  // 云端照片只带相对地址(/media/...),直接塞给 Image 是加载不出来的
  const cloud = P.srcOf({ id: 'cloud', date: '2026-01-01', pose: 'front', url: '/media/photos/x.jpg' });
  ok('云端相对地址拼成完整 URL', /^https?:\/\//.test(cloud) && cloud.endsWith('/media/photos/x.jpg'), cloud);
  ok('本机有文件时优先本地', P.srcOf({ id: 'local', date: '2026-01-01', pose: 'front', path: 'wxfile://a.jpg', url: '/media/x.jpg' }) === 'wxfile://a.jpg');

  console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
