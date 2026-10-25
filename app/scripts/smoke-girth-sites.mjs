/**
 * 围度部位偏好(自建部位 + 显隐) 冒烟测试 —— 存取、清洗、增删、显隐。
 * girth-prefs 要碰本机存储,所以这里照例先 mock 掉 @tarojs/taro 再 require 编译产物。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-girth-sites.mjs
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

const G = require('../.smoke/utils/girth.js');
const P = require('../.smoke/utils/girth-prefs.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/* ================= 清洗:云端/本机拿回来的形状不保证干净 ================= */
section('sanitizeGirthPrefs');
ok('不是对象 → 空偏好', P.sanitizeGirthPrefs(null).custom.length === 0 && P.sanitizeGirthPrefs('x').custom.length === 0
  && P.sanitizeGirthPrefs([]).hidden.length === 0);
{
  const s = P.sanitizeGirthPrefs({
    hidden: ['waistCm', 'waistCm', 'nope', 'x-ab12cd', 42],
    custom: [
      { id: 'ab12cd', name: ' 左上臂 ' },
      { id: 'ef3456', name: '左上臂' },            // 重名:第二个丢
      { id: 'zz9999', name: '腰围' },              // 和内置撞名:丢,内置那个还在
      { id: 'yy8888', name: '' },                  // 空名:丢
      { id: 'xx7777', name: '一二三四五六七八九十一二三' },  // 超长(13 字):丢
      'garbage',                                    // 不是对象:丢
      { id: 'BAD/KEY!', name: '小腿围' }           // id 形状不对:名字留着、id 换新的
    ]
  });
  ok('hidden 只留认得出的键且去重', s.hidden.join(',') === 'waistCm,x-ab12cd', s.hidden.join(','));
  ok('custom 洗完剩两个:左上臂 + 小腿围', s.custom.length === 2 && s.custom[0].name === '左上臂' && s.custom[1].name === '小腿围',
    JSON.stringify(s.custom));
  ok('id 不合规的小腿围换了个合规 id(x- 开头能对上 extras 的键)',
    /^x-[a-z0-9]{4,10}$/.test('x-' + s.custom[1].id) && s.custom[1].id !== 'BAD/KEY!');
  ok('合法 id 原样保留(extras 里挂的数据靠它对上)', s.custom[0].id === 'ab12cd');
}

/* ================= 加 / 删 / 显隐 ================= */
section('自建部位的增删与显隐');
{
  mem.clear();
  ok('空名加不了', P.addCustomSite('   ').ok === false);
  ok('超长名加不了', P.addCustomSite('一二三四五六七八九十一二三四').ok === false);
  ok('和内置撞名加不了', P.addCustomSite('腰围').ok === false);
  const a = P.addCustomSite('左上臂');
  const b = P.addCustomSite('左上臂');
  ok('能加上,重名(不分大小写)拦下', a.ok === true && b.ok === false);
  const c = P.addCustomSite('小腿围');
  ok('两个不同名的部位都进来了', P.loadGirthPrefs().custom.map((x) => x.name).join(',') === '左上臂,小腿围');
  const armId = a.prefs.custom[0].id;
  const legId = c.prefs.custom[1].id;   // 第二个才是刚加的小腿围
  ok('两次加的 id 不一样', armId !== legId && armId.length >= 4);

  // 显隐:内置键和自建键同一份 hidden
  P.toggleSiteKey('thighCm');
  P.toggleSiteKey('x-' + armId);
  const hidden = P.loadGirthPrefs().hidden;
  ok('藏起来的大腿围和左上臂都在 hidden 里', hidden.includes('thighCm') && hidden.includes('x-' + armId));
  ok('activeSites:藏了的内置和自建都不在,小腿围还在',
    G.activeSites(P.loadGirthPrefs()).map((s) => s.k).join(',') === 'waistCm,chestCm,hipCm,armCm,bodyFatPct,x-' + legId,
    G.activeSites(P.loadGirthPrefs()).map((s) => s.k).join(','));
  P.toggleSiteKey('thighCm');
  ok('再点一下 = 放出来', !P.loadGirthPrefs().hidden.includes('thighCm'));

  // availableSites:藏了但有数据的部位还能选着看(别把历史一起藏死)
  const recs = [{ id: 'm1', measuredAt: '2026-10-01T08:00:00.000Z', extras: { ['x-' + armId]: 35 } }];
  const avail = G.availableSites(P.loadGirthPrefs(), recs);
  ok('藏了但量过数的左上臂仍在 available(历史找得回来),没数据的大腿围(已放出)也在',
    avail.some((s) => s.k === 'x-' + armId) && avail.some((s) => s.k === 'thighCm'));

  // 删:连带把它从 hidden 里摘掉
  const after = P.removeCustomSite(armId);
  ok('删掉左上臂后只剩小腿围', after.custom.map((x) => x.name).join(',') === '小腿围');
  ok('hidden 里那把 x- 键也顺手清了(不然 marks/storage 里留死键)',
    !after.hidden.includes('x-' + armId) && after.hidden.length === 0);
}

/* ================= 个数上限 ================= */
section('个数上限');
{
  mem.clear();
  let n = 0;
  for (;;) {
    const r = P.addCustomSite(`部位${n}`);
    if (!r.ok) break;
    n++;
    if (n > 20) break;
  }
  ok(`上限拦在 ${P.CUSTOM_CAP} 个`, n === P.CUSTOM_CAP && P.loadGirthPrefs().custom.length === P.CUSTOM_CAP,
    `实际加到 ${n} 个`);
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
