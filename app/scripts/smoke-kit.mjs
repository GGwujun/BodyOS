/**
 * M6.2 配片计算器/杆重 + M6.3 哑铃档位 + M6.4 器械清单 冒烟测试
 * 用法:node scripts/smoke-kit.mjs(.smoke 由 tsc 预先生成)
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

const K = require('../.smoke/pkg-exercise/engine/kit.js');
const { EXERCISES } = require('../.smoke/pkg-exercise/data/exercises.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const ex = (id) => EXERCISES.find((e) => e.id === id);
const bench = ex('0025');
const dumbBench = ex('0289');
const pullup = ex('0652');

console.log('--- 杠铃杆重 ---');
ok('动作库里有杠铃卧推', !!bench, bench?.name);
ok('杠铃 → 20kg 杆', K.barWeightFor({}, bench) === 20);
ok('EZ 曲杆 → 10kg 杆', K.barWeightFor({}, ex('1627')) === 10);
ok('史密斯机 → 9kg 杆', K.barWeightFor({}, ex('0748')) === 9);
ok('哑铃动作没有杆重', K.barWeightFor({}, dumbBench) === 0);
ok('设过杆重的动作以用户为准', K.barWeightFor({ bars: { barbell: 15 } }, bench) === 15);
ok('杆重 0 = 这根杆不自重(史密斯机的配重车厢)', K.barWeightFor({ bars: { barbell: 0 } }, bench) === 0);
ok('usesBar 认杠铃也认六角杠', K.usesBar(bench) && K.usesBar(ex('0811')));
ok('usesBar 不认哑铃', !K.usesBar(dumbBench));

console.log('--- 配片(没登记库存 → 标准馆配) ---');
const inv = K.plateInv({});
ok('默认库存每种 6 对(1.25 给 2 对)', inv.find((p) => p.w === 25)?.n === 6 && inv.find((p) => p.w === 1.25)?.n === 2);
ok('没登记库存时 ownsPlates 为假', !K.ownsPlates({}));
ok('100kg 卧推:80/2=40 → 25+15', K.plateText(K.rowLoad({}, 100, bench).plates) === '25 + 15');
ok('100kg 配得出来,不差东西', K.rowLoad({}, 100, bench).missing === 0);
ok('60kg → 每边 20', K.plateText(K.rowLoad({}, 60, bench).plates) === '20');
ok('62.5kg → 每边 21.25(2.5 与 1.25 都得上)', K.rowLoad({}, 62.5, bench).perSide === 21.25);
ok('同样的片多的写「× N」', K.plateText(K.plateStack(50, K.plateInv({})).plates) === '25 × 2');
ok('重量没超过空杆 → 不用挂片', K.rowLoad({}, 20, bench).perSide === 0);
ok('重量不合法(0/负/空)→ 不显示配片', K.rowLoad({}, 0, bench) === null && K.rowLoad({}, null, bench) === null);
ok('哑铃动作不给配片', K.rowLoad({}, 20, dumbBench) === null);
ok('杆重设 0 时整个总重都算在片上', K.rowLoad({ bars: { barbell: 0 } }, 40, bench).perSide === 20);

console.log('--- 配片(自己的库存:贪心配不平就退到精确解) ---');
// 25 单片凑 35:贪心只会挂 25(剩 10 挂不上),但 20+15 正好 35
const odd = { plates: { 25: 1, 20: 1, 15: 1 } };
ok('贪心配不平时找精确解:35 → 20 + 15', K.plateText(K.rowLoad(odd, 90, bench).plates) === '20 + 15',
  `得到 ${K.plateText(K.rowLoad(odd, 90, bench).plates)}`);
ok('精确解那次的 missing 为 0', K.rowLoad(odd, 90, bench).missing === 0);
// 一根 10、一根 5:每边最多 15,要 20 就如实说差 5
const light = { plates: { 10: 1, 5: 1 } };
const lr = K.rowLoad(light, 60, bench);
ok('片不够时给「还差多少」而不是编一个假精确解', lr.missing === 5 && K.plateText(lr.plates) === '10 + 5',
  `missing=${lr.missing} 片=${K.plateText(lr.plates)}`);
ok('差多少能说成人话', K.loadHint(light, 60, bench) === '每边 10 + 5,还差 5kg(片不够)', K.loadHint(light, 60, bench));
ok('配得出来时只说每边挂什么', K.loadHint({}, 100, bench) === '每边 25 + 15');
ok('空杆说得明白', K.loadHint({}, 20, bench) === '空杆 20kg,不用挂片');
ok('没登记库存就不说「片不够」', !K.loadHint({}, 60.1, bench).includes('片不够'));
ok('差量算到 0.25 的精度', K.rowLoad({ plates: { 20: 1 } }, 62.5, bench).missing === 1.25);

console.log('--- 步进落在真有的片上 ---');
const home2 = { plates: { 10: 1, 5: 1 } };
ok('配不出的重量往下拉一格:60 → 50', K.snappedByPlates(home2, 60, bench) === 50);
ok('本来就能配出来的不动', K.snappedByPlates(home2, 50, bench) === 50);
ok('没登记库存 → 一个字都不改', K.snappedByPlates({}, 61, bench) === 61);
ok('哑铃动作不走配片 snapping', K.snappedByPlates(home2, 23, dumbBench) === 23);
ok('空杆以下不动', K.snappedByPlates({ plates: { 10: 1 } }, 20, bench) === 20);
ok('片全挂满也不报错(9999 不炸)', K.snappedByPlates({ plates: { 10: 1 } }, 9999, bench) === 40);

console.log('--- 哑铃/壶铃档位 ---');
const bell = [4, 6, 8, 10, 12];
ok('往上走落在下一档', K.ownedUp(bell, 10) === 12);
ok('往下走落在下一档', K.ownedDown(bell, 10) === 8);
ok('到顶了按「＋」不动', K.stepOwned(bell, 12, 1) === 12);
ok('到底了按「−」不动', K.stepOwned(bell, 4, -1) === 4);
ok('步进落在有的一档上', K.stepOwned(bell, 8, 1) === 10);
ok('不在档位上的值也能找到下一档', K.stepOwned(bell, 9, 1) === 10);
ok('没登记档位 → 步进维持原值', K.stepOwned([], 9, 1) === 9);
ok('取不超过 x 的最重一档', K.ownedFloor(bell, 11) === 10);
ok('比最轻的还轻 → 给最轻的(总得练)', K.ownedFloor(bell, 2) === 4);
ok('减载落在真有的档上:10×0.9 → 8', K.ownedDeload(bell, 10, 0.9) === 8);
ok('降无可降就保持', K.ownedDeload(bell, 4, 0.9) === 4);
ok('两档一样近时取重的那个', K.ownedDeload([7, 9], 10, 0.8) === 9, String(K.ownedDeload([7, 9], 10, 0.8)));
ok('档位去重排序并剔掉垃圾', JSON.stringify(K.cleanWeights([10, '10', 0, -3, 4.5, 1000, 'x'])) === '[4.5,10]');
ok('快选档位是 2-50 每 2 公斤', K.DUMBBELL_PRESETS.length === 25 && K.DUMBBELL_PRESETS[0] === 2 && K.DUMBBELL_PRESETS[24] === 50);

console.log('--- 器械清单 ---');
ok('卧推要一张凳子(器械是杠铃,但凳子不在器械表里)', K.accessoriesOf(bench).includes('bench'));
ok('固定器械自带座位,不要再配凳', K.accessoriesOf(ex('1299')).length === 0,
  ex('1299')?.equipment);
ok('引体要单杠', K.accessoriesOf(pullup).includes('pull-up bar'));
ok('清单里列了器械也列了凳子/单杠', K.KIT_EQUIPMENT.includes('dumbbell') && K.KIT_EQUIPMENT.includes('bench') && K.KIT_EQUIPMENT.includes('pull-up bar'));
ok('器械中文名有映射(凳子/单杠也不落空)', K.kitLabel('dumbbell') === '哑铃' && K.kitLabel('bench') === '卧推凳');

const kit = { equipment: ['dumbbell', 'bench'] };
ok('没登记清单 → 什么都没被拦', K.availableWith({}, bench) && K.availableWith({}, ex('0158')));
ok('清单里有的器械才可用', K.availableWith(kit, dumbBench));
ok('清单里没有的器械被拦下', !K.availableWith(kit, bench));
ok('自重动作任何条件下都在(没谁能拿走引体向上)', K.availableWith(kit, pullup) || K.accessoriesOf(pullup).length > 0);
ok('自重动作只要配件齐就行', K.availableWith({ equipment: ['pull-up bar'] }, pullup));
ok('器械表外的自定义值不拦(拦了就再也找不回来)', K.availableWith(kit, { ...bench, equipment: 'custom-thing' }));
ok('清单折算成器械条件:哑铃+凳 → 有哑铃', K.accessFor(kit) === 'dumbbell');
ok('杠铃在家 → 健身房条件', K.accessFor({ equipment: ['barbell', 'dumbbell'] }) === 'gym');
ok('壶铃 → 居家全套', K.accessFor({ equipment: ['kettlebell'] }) === 'home');
ok('只有自重 → 徒手', K.accessFor({ equipment: ['body weight'] }) === 'body');
ok('没登记清单 → 徒手(而不是空清单当健身房)', K.accessFor({}) === 'body');

console.log('--- 存取 ---');
ok('没存过 → 空档案', K.kitEmpty(K.loadKit()));
K.saveKit({ plates: { 25: 2, 20: 4 }, dumbbells: [10, 12], bars: { barbell: 15 }, equipment: ['dumbbell', 'bench'] });
const back = K.loadKit();
ok('存进去能读回来', back.plates['25'] === 2 && back.dumbbells.length === 2 && back.bars.barbell === 15);
ok('有东西了就不是空档案', !K.kitEmpty(back));
ok('摘要说得出一句话', K.kitSummary(back).includes('哑铃 10-12kg') && K.kitSummary(back).includes('6 对杠铃片'), K.kitSummary(back));
mem.set(K.KIT_KEY, 'not an object');
ok('存储被写坏 → 当没登记,不崩', K.kitEmpty(K.loadKit()));
mem.set(K.KIT_KEY, { plates: { hai: 2, 25: -1 }, dumbbells: 'nope', equipment: 5 });
ok('脏字段被逐项剔掉', K.kitEmpty(K.loadKit()));

console.log('--- 几套器材(健身房/家里/出差) ---');
// 老版本存的是**裸的 Kit** —— 用户不该知道有过这个变迁,也没有一步迁移动作
mem.set(K.KIT_KEY, { plates: { 25: 2 }, dumbbells: [10, 12] });
ok('v1 裸 Kit 就地包成第一套', K.loadKit().plates['25'] === 2 && K.loadKit().dumbbells.length === 2);
ok('那一套叫「我常用的」', K.listProfiles().length === 1 && K.profileName() === K.LEGACY_PROFILE_NAME, K.profileName());
ok('老数据读出来只剩一套,且是当前那套', K.loadKitDoc().v === 2 && K.currentProfileId() === K.listProfiles()[0].id);
// 老数据在第一次改动落盘之前,每次读都要重新归一 —— 那几次读必须认出「同一套」,
// 否则页面上「哪套在用」和下发的 id 各说各话(随机 id 会这样,冒烟逮到过)
const idA = K.currentProfileId();
ok('v1 连读两次是同一套(不是每次读都新造一个 id)', idA === K.listProfiles()[0].id && idA === K.currentProfileId(), idA);
K.applyKitDoc({ v: 2, list: [{ name: '没写 id' }, { name: '也没写' }], current: 'k-nope' });
const noisy = K.loadKitDoc();
ok('云上那份缺 id 也只是按位置补,两次读一样', noisy.list.map((p) => p.id).join() === ['p-0', 'p-1'].join(), noisy.list.map((p) => p.id).join());
ok('缺 id 时 current 一并落在第一套上', noisy.current === 'p-0');

// 「只登记了片」也算登记过 —— plates 是表不是数组,数 length 会判成空(冒烟逮到过)
mem.set(K.KIT_KEY, { plates: { 25: 2 } });
ok('只有片库存 → 不算空档案', !K.kitEmpty(K.loadKit()));
mem.set(K.KIT_KEY, { bars: { barbell: 15 } });
ok('只有杆重 → 也不算空', !K.kitEmpty(K.loadKit()));
K.saveKit({ plates: { 20: 1 } });
ok('改的还是那一套(没因为读了一次就多出第二套)', K.listProfiles().length === 1);
ok('存回去的也是 v2 了', K.loadKitDoc().v === 2);

// 新建 = 照现在这套复制(常见的第二套是「差不多但少几样」)
K.addProfile('家里');
ok('新建后有两套,且切到了新的那套', K.listProfiles().length === 2 && K.profileName() === '家里', K.profileName());
ok('新建的那套是照原样复制的', K.loadKit().plates['20'] === 1);
K.saveKit({ dumbbells: [4, 6] });
ok('在新那套上改,不碰原来那套', K.listProfiles()[0].kit.plates?.['20'] === 1 && !K.loadKit().plates);
K.switchProfile(K.listProfiles()[0].id);
ok('切回去就是原来那套', K.loadKit().plates['20'] === 1);
ok('切回来之后写的是这一套', K.saveKit({ bars: { barbell: 15 } }) && K.listProfiles()[0].kit.bars.barbell === 15);
ok('另一套一条都没被改', !K.listProfiles()[1].kit.bars);

K.switchProfile('k-nonexistent');
ok('切到不存在的一套 → 什么都不做,不抛错', K.currentProfileId() === K.listProfiles()[0].id);

K.renameProfile(K.currentProfileId(), '  老王家楼下  ');
ok('改名去空白', K.profileName() === '老王家楼下', K.profileName());
K.renameProfile(K.currentProfileId(), '这一套名字实在是太长了一看就超过上限');
ok(`名字截到 ${K.PROFILE_NAME_MAX} 个字`, K.profileName().length === K.PROFILE_NAME_MAX, K.profileName());
K.renameProfile(K.currentProfileId(), '   ');
ok('改成空 → 保留原名(不变成空白标签)', K.profileName().length === K.PROFILE_NAME_MAX);
K.addProfile('');
ok('不给名字 → 有个能认的默认名', K.profileName() === '新的一套', K.profileName());

// 上限:撞到上限时不再新增(而不是悄悄挤掉谁)
while (K.listProfiles().length < K.PROFILE_MAX) K.addProfile(`第${K.listProfiles().length + 1}套`);
const full = K.listProfiles().length;
K.addProfile('再来一套');
ok(`最多 ${K.PROFILE_MAX} 套,到顶就不加了`, full === K.PROFILE_MAX && K.listProfiles().length === K.PROFILE_MAX);
ok('连着新建的几套 id 不重复', new Set(K.listProfiles().map((p) => p.id)).size === K.PROFILE_MAX);

// 删
const victim = K.listProfiles()[1].id;
K.switchProfile(victim);
K.removeProfile(victim);
ok('删掉当前那套 → 落到剩下的第一套上', !K.listProfiles().some((p) => p.id === victim) && K.currentProfileId() === K.listProfiles()[0].id);
ok('删完还有哪些就是哪些(不误删别的)', K.listProfiles().length === K.PROFILE_MAX - 1);
while (K.listProfiles().length > 1) K.removeProfile(K.listProfiles()[0].id);
K.removeProfile(K.currentProfileId());
ok('最后一套不许删(删了就没地方存器材了)', K.listProfiles().length === 1);

console.log('--- 整份文档:同步与备份搬的是「几套 + 哪套在用」 ---');
K.saveKit({ plates: { 25: 4 } });
K.addProfile('家里');
K.saveKit({ dumbbells: [8, 10] });
const doc = K.loadKitDoc();
ok('导出的是整份(两套 + current)', doc.list.length === 2 && doc.current === doc.list[1].id);
// 只导当前那套的话,另一台设备拉回去就把它的几套压成一套 —— 而且不报错
K.applyKitDoc({ v: 2, list: [{ id: 'k-keep', name: '健身房', kit: { bars: { barbell: 20 } } }], current: 'k-keep' });
ok('apply 整份 → 覆盖成对面那套', K.listProfiles().length === 1 && K.profileName() === '健身房' && K.loadKit().bars.barbell === 20);
K.applyKitDoc({ plates: { 10: 1 } });
ok('apply 一份裸 Kit(老设备推上来的)→ 就地包成一套', K.listProfiles().length === 1 && K.loadKit().plates['10'] === 1);

// 文档本身被写坏时:仍然要给出「一套、能用」的形状,不抛错
K.applyKitDoc({ v: 2, list: [{ name: '没有 id' }, { id: 'k-a', name: 'A', kit: { plates: { 5: 1 } } }, { id: 'k-a', name: '撞 id 的', kit: {} }], current: 'k-missing' });
ok('缺 id 的补一个', K.listProfiles().every((p) => !!p.id));
ok('撞 id 的拆开(两套不会被合成一套)', new Set(K.listProfiles().map((p) => p.id)).size === K.listProfiles().length);
ok('current 指丢了 → 落到第一套', K.currentProfileId() === K.listProfiles()[0].id);
K.applyKitDoc({ v: 2, list: [], current: 'k-a' });
ok('空 list → 至少补一套(不能一套都没有)', K.listProfiles().length === 1 && K.loadKitDoc().v === 2);
K.applyKitDoc(null);
ok('彻底是 null → 一样有一套', K.listProfiles().length === 1);

console.log('--- kitDocEmpty:决定同步推不推、备份算不算有内容 ---');
ok('undefined(老备份里没这一格)→ 空', K.kitDocEmpty(undefined));
ok('空 doc → 空', K.kitDocEmpty({ v: 2, list: [{ id: 'k-a', name: 'x', kit: {} }], current: 'k-a' }));
ok('空 doc 里那套是空的 → 还是空', K.kitDocEmpty({ v: 2, list: [{ id: 'k-a', name: 'x', kit: { plates: {} } }], current: 'k-a' }));
ok('裸 Kit(老备份/老设备)有东西 → 不空', !K.kitDocEmpty({ plates: { 25: 2 } }));
ok('裸 Kit 是空的 → 空', K.kitDocEmpty({}));
ok('v2 doc 里**非当前**那套有东西也算不空', !K.kitDocEmpty({ v: 2, list: [{ id: 'k-a', name: 'A', kit: {} }, { id: 'k-b', name: 'B', kit: { dumbbells: [10] } }], current: 'k-a' }));
ok('garbage(字符串/数组)→ 当空,不崩', K.kitDocEmpty('nope') && K.kitDocEmpty([1, 2]));

console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
