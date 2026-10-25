/**
 * M10.12 自定义动作 冒烟测试 —— 用户自己建的动作,要像一个**正经的动作**那样被对待。
 *
 * 这一层的价值全在「下游认不认它」上:建完只是往 storage 里放一条记录,
 * 真正难的是**按 id 走的那一整套口径**(单侧怎么折、重量怎么念、肌群统计算哪一块、
 * 换动作给不给它、计划文字认不认它、删掉之后历史还认不认它)一处都不用改就认它。
 * 所以下面按「口径」分节,每节都在钉一件事:自定义动作和动作库里的动作**同一条路**。
 *
 * 三个和 openGym `customEx` 不一样的决定,以及它们各自的后果,也在下面钉住:
 *   ① 不另开描述字段(要点写进既有的动作备注,按 id 存的那一份);
 *   ② 单侧/助力是勾出来的,不靠名字猜(名字正则的射程里根本没有用户起的名字);
 *   ③ 删除是**退场**不是抹掉(历史统计照算;openGym 那种真删会让历史凭空少几周的量)。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-custom.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* ---------------- mock Taro:内存存储 ---------------- */
const mem = new Map();
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); }
};
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: storage, ...storage };
  return origLoad.call(this, req, ...rest);
};

const ENGINE = '../.smoke/pkg-exercise/engine/';
const C = require(`${ENGINE}custom.js`);
const PURGE = require(`${ENGINE}custom-purge.js`);
const G = require(`${ENGINE}generator.js`);
const SIDED = require(`${ENGINE}sided.js`);
const LOAD = require(`${ENGINE}load.js`);
const MU = require(`${ENGINE}muscles.js`);
const PT = require(`${ENGINE}plan-text.js`);
const Store = require(`${ENGINE}store.js`);
const F = require(`${ENGINE}fav.js`);
const MX = require(`${ENGINE}max.js`);
const { EXERCISES } = require('../.smoke/pkg-exercise/data/exercises.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const eq = (name, got, want) => ok(name, got === want, `${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
const section = (t) => console.log(`\n--- ${t} ---`);

const draft = (over = {}) => ({ name: '器械推胸机', bodyPart: 'chest', equipment: 'leverage machine', ...over });
/** 建一个并拿到它的 id(失败就抛 —— 用例里不该出现意料之外的不通过) */
const mk = (over = {}) => {
  const r = C.addCustom(draft(over));
  if (!r.ok) throw new Error(`建动作失败:${r.why}`);
  return r.ex;
};
const benchId = (EXERCISES.find((e) => e.nameZh === '杠铃卧推') ?? {}).id;

/* ===================== ① 清洗(本机/云端/备份三条路同一个函数) ===================== */
section('清洗:脏数据不许变成「一个键不存在的动作」');

ok('不是数组 → 空', C.sanitizeCustom(null).length === 0 && C.sanitizeCustom({}).length === 0 && C.sanitizeCustom('x').length === 0);
ok('缺 id / 缺名字的都丢掉', C.sanitizeCustom([{ name: 'a', bodyPart: 'chest', equipment: 'barbell' }, { id: 'c-1', bodyPart: 'chest', equipment: 'barbell' }]).length === 0);
ok('部位认不出来 → 丢(留着它换动作候选与肌群统计都会算在一个不存在的键上)',
  C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: '不存在的部位', equipment: 'barbell' }]).length === 0);
ok('器械认不出来 → 丢', C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: '外星器械' }]).length === 0);
ok('id 重复的只留一条', C.sanitizeCustom([
  { id: 'c-1', name: '甲', bodyPart: 'chest', equipment: 'barbell' },
  { id: 'c-1', name: '乙', bodyPart: 'chest', equipment: 'barbell' }
]).length === 1);
eq('名字超长截到上限', C.sanitizeCustom([{ id: 'c-1', name: 'x'.repeat(99), bodyPart: 'chest', equipment: 'barbell' }])[0].name.length, C.NAME_MAX);
eq('名字两边空白去掉', C.sanitizeCustom([{ id: 'c-1', name: '  推胸机  ', bodyPart: 'chest', equipment: 'barbell' }])[0].name, '推胸机');
ok('肌群只留词表里有的', C.sanitizeCustom([
  { id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', target: 'chest', secondary: ['shoulders', '外星肌'] }
])[0].secondary.join() === 'shoulders');
ok('主要肌群和次要肌群重了 → 次要那边去掉(不然统计里同一个大组记两次)', (() => {
  const c = C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', target: 'chest', secondary: ['chest', 'chest'] }])[0];
  return c.target === 'chest' && c.secondary.length === 0;
})());
ok('次要肌群去重', C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', secondary: ['back', 'back'] }])[0].secondary.length === 1);
ok('主要肌群不认识就当没填(空串 = 不进七个大组)', C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', target: '外星肌' }])[0].target === '');
ok('单侧/助力只认 true(字符串 "true" 这种脏值不当真)', (() => {
  const c = C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', sided: 'true', assisted: 1 }])[0];
  return c.sided === false && c.assisted === false;
})());
ok('退场标记是可选字段(没有就不带这个键)', (() => {
  const a = C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell' }])[0];
  const b = C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', deletedAt: '2026-10-01T00:00:00.000Z' }])[0];
  return !('deletedAt' in a) && b.deletedAt === '2026-10-01T00:00:00.000Z';
})());
ok('缺 createdAt 补一个(不能留空的排序依据)', typeof C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell' }])[0].createdAt === 'string');
eq('最多留 CUSTOM_CAP 条', C.sanitizeCustom(
  Array.from({ length: C.CUSTOM_CAP + 40 }, (_, i) => ({ id: `c-${i}`, name: `动作${i}`, bodyPart: 'chest', equipment: 'barbell' }))
).length, C.CUSTOM_CAP);

/* ===================== ② 建 / 改 / 退场 / 撤销 ===================== */
section('建 / 改 / 退场 / 撤销');

mem.clear();
const chest = mk();
ok('id 是 c- 开头(和动作库那套 4 位数字天然分得开)', /^c-[a-z0-9]{8}$/.test(chest.id), chest.id);
ok('建完就在列表里,且认得出是自定义的', C.listCustom().length === 1 && C.isCustomId(chest.id) && !C.isCustomId(benchId));
ok('新动作排在最前面(自己建的就是为了常用)', C.listCustom()[0].id === chest.id);
ok('落到 storage 里了', Array.isArray(mem.get('bodyos.training.custom')) && mem.get('bodyos.training.custom')[0].id === chest.id);
ok('写了就记一笔修改时间(云同步靠它判先后)', !!mem.get('bodyos.sync.marks')?.['custom|main']);

eq('没名字 → 不听', C.addCustom(draft({ name: '   ' })).why, '给这个动作起个名字');
eq(`名字超过 ${C.NAME_MAX} 个字 → 不听`, C.addCustom(draft({ name: 'x'.repeat(C.NAME_MAX + 1) })).why, `名字太长了(最多 ${C.NAME_MAX} 个字)`);
eq('没选部位 → 不听', C.addCustom(draft({ bodyPart: '' })).why, '选一个部位');
eq('没选器械 → 不听', C.addCustom(draft({ equipment: '' })).why, '选一种器械');
eq('重名 → 不听(自己建的之间不许重名,不然列表里两条一模一样)',
  C.addCustom(draft({ name: '  器械推胸机 ' })).why, '已经有一个叫「器械推胸机」的动作了');
ok('重名判定忽略空格(「我的 推胸机」=「我的推胸机」)',
  C.addCustom(draft({ name: '我的推胸机', equipment: 'barbell' })).ok
  && !C.addCustom(draft({ name: '我的 推胸机' })).ok);
ok('和**动作库里**的动作重名是允许的(你的「杠铃卧推」可能就是那台器械的另一种叫法)',
  C.addCustom(draft({ name: '杠铃卧推' })).ok);
ok('失败时不写盘(列表还是原来那些)', C.listCustom().length === 3, String(C.listCustom().length));

const up = C.updateCustom(chest.id, draft({ name: '推胸机', target: 'chest', secondary: ['shoulders', 'upper arms'], sided: true, assisted: false }));
ok('改名字成功', up.ok && C.findCustom(chest.id).name === '推胸机');
eq('改完 createdAt 还是原来那个(不是「新动作」)', C.findCustom(chest.id).createdAt, chest.createdAt);
eq('改重名照样拦(但不算自己跟自己重名)', C.updateCustom(chest.id, draft({ name: '杠铃卧推' })).why, '已经有一个叫「杠铃卧推」的动作了');
eq('改一个不存在的 → 说人话', C.updateCustom('c-nope', draft()).why, '这个动作已经不在了');
ok('改名后主要肌群和次要肌群一个键都不重复', (() => {
  const c = C.findCustom(chest.id);
  return c.secondary.length === 2 && !c.secondary.includes(c.target);
})());
ok('勾了单侧就是单侧', C.findCustom(chest.id).sided === true);

ok('退场成功后从「能挑的」里消失', C.retireCustom(chest.id) && C.listCustom().every((c) => c.id !== chest.id));
ok('但 allCustom 还留着它(历史里的账要认它)', C.allCustom().some((c) => c.id === chest.id));
ok('按 id 照样找得到(名字、器械、单侧口径都还在)', !!C.findCustom(chest.id) && C.findCustom(chest.id).sided === true);
ok('退场是幂等的(再退一次不写盘、不推同步)', C.retireCustom(chest.id) === false);
ok('撤销退场能回来', C.reviveCustom(chest.id) && C.listCustom().some((c) => c.id === chest.id));
ok('撤销也是幂等的', C.reviveCustom(chest.id) === false);
ok('没退场过的说话不响', C.reviveCustom(benchId) === false);

/* ===================== ②½ 配图 ===================== */
/* 只认上传接口给的 `/media/<hash>.<ext>`:渲染层拿它直接拼地址,存了任意串(外链、
   相对页路径)就是一个能被人塞东西进去的口子。建/改/清洗三处必须是同一个判定。 */
section('配图:存的是上传接口给的地址,别的串一律当没有');

ok('合法地址(/media/<hash>.<ext>)原样保留', (() => {
  const c = C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', image: '/media/0123abcddeadbeef.jpg' }])[0];
  return c.image === '/media/0123abcddeadbeef.jpg';
})());
ok('外链不存', !('image' in C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', image: 'https://x.com/a.jpg' }])[0]));
ok('带路径分隔符的不存(演示图那种 /media/ex/x.gif 不是用户上传的形状)', !('image' in C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', image: '/media/ex/x.gif' }])[0]));
ok('非字符串(数字/true)不存', (() => {
  const a = C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', image: 42 }])[0];
  const b = C.sanitizeCustom([{ id: 'c-1', name: 'a', bodyPart: 'chest', equipment: 'barbell', image: true }])[0];
  return !('image' in a) && !('image' in b);
})());

const picEx = mk({ name: '带配图的机', image: '/media/pic1.webp' });
eq('建的时候带上配图', C.findCustom(picEx.id).image, '/media/pic1.webp');
ok('建的时候给了不合法的 → 当没图(配图不是必填,别让它挡住建动作)', !('image' in C.findCustom(mk({ name: '坏配图的机', image: 'javascript:alert(1)' }).id)));
C.updateCustom(picEx.id, draft({ name: '带配图的机', image: '/media/pic2.png' }));
eq('改成另一张', C.findCustom(picEx.id).image, '/media/pic2.png');
C.updateCustom(picEx.id, draft({ name: '带配图的机' }));
ok('改的时候没传配图 = 清掉(表单送的是完整状态:「删掉配图」再保存,图不该还在)', !('image' in C.findCustom(picEx.id)));
C.updateCustom(picEx.id, draft({ name: '带配图的机', image: 'http://evil/' }));
ok('改成不合法的也清掉(不是保留旧图 —— 用户那个动作明明点过换图)', !('image' in C.findCustom(picEx.id)));

/* customImage 是渲染层问「这个动作有没有用户配图」的唯一入口(优先级:演示图 > 它 > 肌群示意图) */
eq('customImage:有图的给地址', C.customImage(mk({ name: '问图的机', image: '/media/ask.jpg' }).id), '/media/ask.jpg');
ok('customImage:没图的自定义动作 → undefined', C.customImage(picEx.id) === undefined);
ok('customImage:库里动作没有这回事(非 c- 开头一律 undefined)', C.customImage(benchId) === undefined);
ok('customImage:认不出的自定义 id 也不炸', C.customImage('c-nope') === undefined);

/* ===================== ③ 口径层:单侧 / 助力 / 负重 ===================== */
section('口径层:按 id 走的那一整套都认它');

const libSided = SIDED.isSided(benchId) === false && SIDED.isSided((EXERCISES.find((e) => /single|one[- ]arm|lunge/i.test(e.name)) ?? {}).id) === true;
ok('动作库那套名字正则没被动过(库里的单侧动作照旧是单侧)', libSided);
ok('自定义动作:勾了就是单侧', SIDED.isSided(chest.id) === true);
const two = mk({ name: '双手推胸机', bodyPart: 'chest', equipment: 'leverage machine' });
ok('自定义动作:没勾就不是 —— 哪怕名字里有「单臂」也不会被猜成单侧',
  SIDED.isSided(mk({ name: '单臂推胸机', bodyPart: 'chest', equipment: 'leverage machine' }).id) === false);
ok('次数折半的说法照旧走同一条路(16-20 次 = 每侧 8-10)', SIDED.sideRangeText(16, 20, SIDED.isSided(chest.id)) === '16-20 次(每侧 8-10)');
ok('非单侧动作不折', SIDED.sideRangeText(16, 20, SIDED.isSided(two.id)) === '16-20 次');

const assistedEx = mk({ name: '助力引体机', bodyPart: 'back', equipment: 'leverage machine', assisted: true });
ok('自定义动作:勾了助力就是助力', LOAD.isAssisted(assistedEx.id) === true);
ok('自定义动作:没勾就是没勾 —— 名字里有「助力」也不会被猜',
  LOAD.isAssisted(mk({ name: '助力推胸机', bodyPart: 'chest', equipment: 'leverage machine' }).id) === false);
ok('助力动作不进力量纪录(1RM 那条路口径一致)', (() => {
  const w = mk({ name: '负重推胸机', bodyPart: 'chest', equipment: 'weighted' });
  return LOAD.isAddedWeight(w.id) === true && LOAD.isAddedWeight(two.id) === false;
})());
ok('负重自重动作:数字是附加重量,按器械判(库里的那条也一样)', LOAD.isAddedWeight(chest.id) === false);

section('认 id 的每一层都认它');
const asE = C.asEntry(C.findCustom(chest.id));
eq('换出来的是动作库那个形状', asE.id, chest.id);
eq('名字是用户起的那个(没有英文原名)', asE.nameZh, '推胸机');
ok('英文原名是空串(详情弹层那行英文名对空串不显示)', asE.name === '');
ok('分类/难度/发力/结构留空(自定义动作不参与自动编排)', asE.category === '' && asE.level === '' && asE.force === '' && asE.mechanic === '' && asE.steps.length === 0);
eq('findExercise 认自定义 id', (G.findExercise(chest.id) ?? {}).nameZh, '推胸机');
ok('findExercise 对不认识的自定义 id 还是 undefined', G.findExercise('c-nope') === undefined);
ok('退场之后 findExercise 照样认(历史要能显示名字)', (() => {
  C.retireCustom(two.id);
  const hit = G.findExercise(two.id);
  C.reviveCustom(two.id);
  return !!hit && hit.nameZh === '双手推胸机';
})());
ok('customEntries 只给「还在用的」', C.customEntries().every((e) => !C.findCustom(e.id)?.deletedAt));

/* ===================== ④ 肌群统计 / 恢复 ===================== */
section('肌群统计');
ok('挑的那七个肌群键,在 GROUP_OF 里都 1:1 归到对应大组(挑了必进统计)',
  MU.groupsOf(chest.id).some((g) => g.group === 'chest'));
ok('主要肌群算 1 组、次要算 0.5 组', (() => {
  const gs = MU.groupsOf(chest.id);
  const chestG = gs.find((g) => g.group === 'chest');
  const shoulderG = gs.find((g) => g.group === 'shoulder');
  return chestG.w === MU.PRIMARY_W && shoulderG.w === MU.SECONDARY_W;
})());
ok('没填肌群的自定义动作不进统计(不报错,也不瞎算)', MU.groupsOf(mk({ name: '说不清练哪', bodyPart: 'chest', equipment: 'barbell' }).id).length === 0);
ok('练过的组数算进那个大组(和库里动作一条路)', (() => {
  const log = {
    id: 'wo-c', planId: 'p1', dayKey: 'a', dayTitle: '', date: '2026-10-14', durationSec: 600,
    totalSets: 4, totalReps: 40, totalVolumeKg: 0, avgRir: 2,
    entries: [{ exerciseId: chest.id, nameZh: '推胸机', sets: [{ reps: 10, weightKg: 40, rir: 2 }] }]
  };
  const st = MU.loadsOf([log]).find((s) => s.group === 'chest');
  return st.rawSets === 1 && st.sets === 1;
})());
ok('推拉平衡 / 上下肢平衡也认它(按部位走)', MU.pushPullOf(chest.id) !== null && MU.upperLowerOf(chest.id) !== null);

/* ===================== ⑤ 计划文字:导出 → 粘回来 ===================== */
section('计划文字');
const item = G.buildItem(G.bestPatternOf(chest.id, 'beginner'), G.findExercise(chest.id), 'muscle', 'beginner');
ok('装进槽位后次数口径跟着单侧走(勾了单侧 → 合计是偶数、标了单侧)',
  item.sided === true && item.repsMin % 2 === 0 && item.repsMax % 2 === 0, `${item.repsMin}-${item.repsMax}`);
const plan = {
  id: 'p-c', createdAt: '2026-10-01T00:00:00.000Z', goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek: 1, sessionMin: 60, doneCount: 0, lastNote: '',
  days: [{ key: 'a', title: '推', focus: '', estMin: 40, items: [item] }]
};
const text = PT.planToText(plan);
ok('导出的那一行带着它的编号(名字可能重,编号不会)', text.includes(`(${chest.id})`), text.split('\n').find((l) => l.includes('推胸机')));
const back = PT.parsePlanText(text, { now: 0 });
eq('粘回来还是同一个动作(按编号认)', back.plan.days[0].items[0].exerciseId, chest.id);
eq('处方原样回来(组数/次数/休息)', `${back.plan.days[0].items[0].sets}|${back.plan.days[0].items[0].repsMin}|${back.plan.days[0].items[0].repsMax}|${back.plan.days[0].items[0].restSec}`,
  `${item.sets}|${item.repsMin}|${item.repsMax}|${item.restSec}`);
eq('名字也原样回来(用户起的名字就是他认的那个)', back.plan.days[0].items[0].nameZh, '推胸机');

// 名字要挑一个库里没有的(库里有「推胸机」那条 —— 见下面那条同名用例)
const own = mk({ name: '器械推胸机台', bodyPart: 'chest', equipment: 'leverage machine', target: 'chest' });
const hand = PT.parsePlanText('第 1 天 推\n1 器械推胸机台 · 3 组 × 10 次 · 40kg', { now: 0 });
eq('手写的、没有编号也认(按名字问自己建的那些)', hand.plan.days[0].items[0].exerciseId, own.id);
const noId = PT.parsePlanText(`第 1 天 推\n1 器械推胸机台 (c-00000000) · 3 组 × 10 次`, { now: 0 });
eq('编号认不出来(别人建的动作)→ 退回按名字认,自己建个同名的再粘一次就认了', noId.plan.days[0].items[0].exerciseId, own.id);
const stranger = PT.parsePlanText('第 1 天 推\n1 器械飞鸟机 (c-00000000) · 3 组 × 10 次', { now: 0 });
eq('名字编号都不认识 → 两个都报出来', stranger.dropped[0].why, '认不出这个动作:「器械飞鸟机」(编号 c-00000000 不在你的动作库里)');
eq('只报这一行,别的照导入', stranger.dropped.length, 1);
ok('同一个名字自己建的动作不会让库里的动作认不出来', (() => {
  // 上面已经建过一个叫「杠铃卧推」的自定义动作:按名字认时动作库优先,
  // 所以老计划里的「杠铃卧推」还是那个库里的动作(不然就变成「同名多个」了)
  const r = PT.parsePlanText('第 1 天 推\n1 杠铃卧推 · 3 组 × 8 次', { now: 0 });
  return r.plan?.days[0].items[0].exerciseId === benchId;
})());
ok('和库里的动作同名时,没有编号的那一行认**库里的**(建个同名动作不会悄悄改掉老计划的意思)', (() => {
  const r = PT.parsePlanText('第 1 天 推\n1 推胸机 · 3 组 × 10 次', { now: 0 });
  return r.plan?.days[0].items[0].exerciseId !== chest.id && !C.isCustomId(r.plan.days[0].items[0].exerciseId);
})());

/* ===================== ⑥ 换动作候选 / 自动计划 ===================== */
section('换动作候选与自动计划');
const pool = G.patternPool('gym', 'beginner');
const buckets = Object.entries(pool).filter(([, list]) => list.some((e) => e.id === chest.id));
ok('换动作候选里有它(计划写着健身房,它也是那身器械)', buckets.length === 1, buckets.map(([k]) => k).join(','));
eq('放在该模式的**最后**(它是「我另有的选择」,不该挤掉编排挑的首选)',
  pool[buckets[0][0]][pool[buckets[0][0]].length - 1].id, chest.id);
ok('器械条件不满足时不给它(计划写着徒手,就不该推一台固定器械给他换)', (() => {
  const bodyPool = G.patternPool('body', 'beginner');
  return Object.values(bodyPool).every((list) => !list.some((e) => e.id === chest.id));
})());
ok('新建一个动作之后这一池立刻重算(不用等下次冷启动)', (() => {
  const fresh = mk({ name: '划船机', bodyPart: 'back', equipment: 'cable' });
  return Object.values(G.patternPool('gym', 'beginner')).some((list) => list.some((e) => e.id === fresh.id));
})());
ok('自动生成的计划里没有自定义动作(没经过打分那套判据,不该让它决定编排)', (() => {
  const gen = G.generatePlan({ goal: 'muscle', level: 'beginner', access: 'gym', daysPerWeek: 3, sessionMin: 60 });
  return gen.days.every((d) => d.items.every((it) => !C.isCustomId(it.exerciseId)));
})());

/* ===================== ⑦ 删除:退场 + 摘干净,但历史留着 ===================== */
section('删除(退场,不是抹掉)');

const victim = mk({ name: '要删的动作', bodyPart: 'back', equipment: 'cable', target: 'back', secondary: ['upper arms'] });
const keeper = mk({ name: '留下的动作', bodyPart: 'chest', equipment: 'barbell', target: 'chest' });
const mkItem = (exId, over = {}) => ({
  exerciseId: exId, nameZh: exId, patternId: 'hpull', sets: 3, repsMin: 8, repsMax: 12, restSec: 90,
  progression: 'linear', weightKg: 40, weightStepKg: 2.5, alternates: [], ...over
});
Store.savePlan({
  ...plan,
  days: [{ key: 'a', title: '拉', focus: '', estMin: 40, items: [
    mkItem(victim.id),
    mkItem(keeper.id),
    mkItem(victim.id, { superset: 'A' }),
    mkItem(keeper.id, { superset: 'A' }),
    mkItem(keeper.id, { alternates: [victim.id, benchId] })
  ] }]
});
Store.saveProgress({ [victim.id]: { exerciseId: victim.id, weightKg: 40, repsMin: 8, repsMax: 12, successStreak: 0, failStreak: 0, suggestion: null, updatedAt: '2026-10-01T00:00:00.000Z' } });
Store.setNote(keeper.id, '留着的备注');
Store.setNote(victim.id, '要删的备注');
F.saveFavs([victim.id, keeper.id]);
MX.setMax(victim.id, '要删的动作', 50);
const oldLog = {
  id: 'wo-old', planId: 'p-c', dayKey: 'a', dayTitle: '拉', date: '2026-09-20', durationSec: 3000,
  totalSets: 3, totalReps: 30, totalVolumeKg: 0, avgRir: 2,
  entries: [{ exerciseId: victim.id, nameZh: '要删的动作', sets: [{ reps: 10, weightKg: 40, rir: 2 }, { reps: 10, weightKg: 40, rir: 2 }] }]
};
Store.saveLogs([oldLog]);

const res = PURGE.purgeCustom(victim.id);
ok('确实退场了', res.retired === true);
ok('计划里正选 + 超级组 + 换动作候选里的一共 3 处都摘了', res.planned === 3, String(res.planned));
ok('计划里再也找不到这个 id', (() => {
  const p = Store.loadPlan();
  return p.days.every((d) => d.items.every((it) => it.exerciseId !== victim.id && !it.alternates.includes(victim.id)));
})());
ok('摘掉超级组里的一半 → 落单的那个自己解散(不留下没有同伴的徽标)',
  Store.loadPlan().days[0].items.every((it) => !it.superset));
ok('没被牵连的动作原样留着(引用不变,页面不白重渲染)', Store.loadPlan().days[0].items.some((it) => it.exerciseId === keeper.id));
ok('渐进状态里也摘了', res.progress === true && Store.loadProgress()[victim.id] === undefined);
ok('备注摘了,别的动作的备注没动', res.note === true && Store.loadNotes()[victim.id] === undefined && Store.loadNotes()[keeper.id] === '留着的备注');
ok('收藏摘了,别的收藏没动', res.fav === true && F.loadFavs().join() === keeper.id);
ok('力量基准摘了(它不在动作库的助力集合里,max 自己不会清它)', res.max === true && !(victim.id in MX.loadMaxes()));
ok('能挑的列表里没有它了', C.listCustom().every((c) => c.id !== victim.id));
ok('**历史日志一个字没动** —— 上个月用它的那次训练照旧算数', (() => {
  const logs = Store.loadLogs();
  return logs.length === 1 && logs[0].entries[0].exerciseId === victim.id;
})());
ok('那次训练的组数照旧进肌群统计(删一个动作不该让历史账目凭空少一块)', (() => {
  const st = MU.loadsOf(Store.loadLogs()).find((s) => s.group === 'back');
  return st.rawSets === 2;
})());
ok('历史里那个动作的名字还认得出(详情/历史页不会掉成一个裸编号)', (G.findExercise(victim.id) ?? {}).nameZh === '要删的动作');
ok('删第二次不炸、也不再动任何东西(幂等)', (() => {
  const again = PURGE.purgeCustom(victim.id);
  return again.retired === false && again.planned === 0 && again.progress === false && again.note === false && again.fav === false && again.max === false;
})());
ok('删一个不存在的 id 不炸', (() => {
  const r = PURGE.purgeCustom('c-nope');
  return r.retired === false && r.planned === 0;
})());

/* ===================== ⑧ 整份覆盖(云同步 / 备份写回那条路) ===================== */
section('整份覆盖:洗完才落地,且不记自己的修改时间');
mem.clear();
const twin = mk({ name: '同步过来的动作', bodyPart: 'back', equipment: 'barbell' });
const stampBefore = mem.get('bodyos.sync.marks')?.['custom|main'];
C.saveCustom([twin, { id: 'c-bad', name: '坏数据', bodyPart: '外星部位', equipment: 'barbell' }]);
eq('脏记录落不了地', C.allCustom().length, 1);
eq('本机这份被整份换掉了', C.allCustom()[0].name, '同步过来的动作');
eq('覆盖不记修改时间(否则本机会永远比云端新,云端那份再也拉不下来)', mem.get('bodyos.sync.marks')?.['custom|main'], stampBefore);
C.saveCustom(null);
eq('覆盖成空 = 真的空(备份的 replace 模式要用)', C.allCustom().length, 0);
C.saveCustom([
  { id: 'c-img', name: '带图的', bodyPart: 'chest', equipment: 'barbell', image: '/media/rt.jpg' },
  { id: 'c-img2', name: '坏图的', bodyPart: 'chest', equipment: 'barbell', image: 'http://evil' }
]);
eq('云同步/备份那条路:合法配图落地', C.findCustom('c-img').image, '/media/rt.jpg');
ok('云同步/备份那条路:不合法的配图落地时被洗掉(和本机建/改是同一个判定)',
  !('image' in C.findCustom('c-img2')));

/* ===================== ⑨ 撤销删除:摘掉的几格按 id 还回去 ===================== */
/* 为什么值得单独一节:删除**不是**少一行列表 —— 计划里那几处编排、力量基准(下次开多重
   看它)、常驻备注是**没有别的地方能复原**的。所以撤销必须真的还回来,而且:
   ① 只还自己摘掉的那几格(不碰别人的);
   ② 计划那一份**比对不过就不写**(计划按位置存,整份覆盖会抹掉这几秒里别处的改动);
   ③ 单槽 —— 撤销只有效一次,别让第二次把上一个动作的底稿又放一遍。 */
section('撤销删除:摘掉的几格真的还回来');
const ghost = mk({ name: '误删的动作', bodyPart: 'back', equipment: 'cable', target: 'back' });
Store.savePlan({
  ...plan,
  days: [{ key: 'a', title: '拉', focus: '', estMin: 40, items: [
    mkItem(ghost.id),
    mkItem(keeper.id),
    mkItem(keeper.id, { alternates: [ghost.id] })
  ] }]
});
Store.saveProgress({ [ghost.id]: { exerciseId: ghost.id, weightKg: 40, repsMin: 8, repsMax: 12, successStreak: 0, failStreak: 0, suggestion: null, updatedAt: '2026-10-01T00:00:00.000Z' } });
Store.setNote(ghost.id, '误删的备注');
Store.setNote(keeper.id, '旁观的备注');
F.saveFavs([ghost.id, keeper.id]);
MX.setMax(ghost.id, '误删的动作', 50);
const beforeJson = JSON.stringify(Store.loadPlan());
const pres = PURGE.purgeCustom(ghost.id);
ok('删的时候:计划两处 + 渐进 + 备注 + 收藏 + 基准都摘了',
  pres.planned === 2 && pres.progress && pres.note && pres.fav && pres.max,
  JSON.stringify(pres));

const u = PURGE.undoPurge();
ok('动作回到了可选列表(不是只把记录标活)', u.ok === true && C.listCustom().some((c) => c.id === ghost.id));
ok('计划**一字不差**地回到删之前那一份(超组/换动作候选都没丢)',
  u.plan === true && JSON.stringify(Store.loadPlan()) === beforeJson);
ok('渐进状态还回来了(接着上次的渐进往下走,不是从零开始)',
  u.progress === true && Store.loadProgress()[ghost.id]?.weightKg === 40);
ok('备注还回来了', u.note === true && Store.loadNotes()[ghost.id] === '误删的备注');
ok('收藏还回来了,而且没挤掉别人', u.fav === true && F.loadFavs().join() === [ghost.id, keeper.id].join());
ok('力量基准还回来了(下次开多重照旧)', u.max === true && MX.tmOf(MX.loadMaxes(), ghost.id) > 0);
ok('没碰别的动作:旁观的备注原样、收藏就这两条(撤销不是「整份回退」)',
  Store.loadNotes()[keeper.id] === '旁观的备注' && F.loadFavs().length === 2);
ok('单槽:**第二次撤销不成**,不会把上一次的底稿再放一遍', PURGE.undoPurge().ok === false);

section('计划被人改过 → 动作还回来,但计划那一份不动(CAS)');
const back2 = mk({ name: '第二个误删', bodyPart: 'back', equipment: 'cable', target: 'back' });
Store.savePlan({ ...Store.loadPlan(), days: [{ key: 'a', title: '拉', focus: '', estMin: 40, items: [mkItem(back2.id), mkItem(keeper.id)] }] });
Store.setNote(back2.id, '第二个的备注');
PURGE.purgeCustom(back2.id);
const edited = Store.loadPlan();
Store.savePlan({ ...edited, days: edited.days.map((d) => ({ ...d, title: '别处改过的标题' })) });
const u2 = PURGE.undoPurge();
ok('动作本体还是还回来了(撤销不能因为计划对不上就整个失败)', u2.ok === true && C.listCustom().some((c) => c.id === back2.id));
ok('但计划里没有它的那一行(计划为位置存储,整份回退会抹掉别处的改动)', u2.plan === false && Store.loadPlan().days[0].items.every((it) => it.exerciseId !== back2.id));
ok('别处的改动**原样留着** —— 撤销绝不悄悄回退别人的编辑', Store.loadPlan().days[0].title === '别处改过的标题');
ok('按 id 存的那几格不受计划这份影响,照样还回来', u2.note === true && Store.loadNotes()[back2.id] === '第二个的备注');

section('撤销的两个边界:太久了 / 删的根本不存在');
const back3 = mk({ name: '过期的误删', bodyPart: 'back', equipment: 'cable' });
PURGE.purgeCustom(back3.id);
const rec = mem.get('bodyos.training.purge_undo');
ok('删完留了一份撤销底稿', rec && rec.id === back3.id);
mem.set('bodyos.training.purge_undo', { ...rec, at: Date.now() - 6 * 60_000 });
const u3 = PURGE.undoPurge();
ok('过了窗口就撤不回来,并且把底稿清掉(不留着等一个不会来的点击)', u3.ok === false && !mem.get('bodyos.training.purge_undo'));
ok('撤不回来时动作仍然是退场状态(没有留成半截)', C.listCustom().every((c) => c.id !== back3.id));

const back4 = mk({ name: '还要再删一次的', bodyPart: 'back', equipment: 'cable' });
PURGE.purgeCustom(back4.id);
PURGE.purgeCustom('c-nope');
PURGE.purgeCustom(back4.id);
const u4 = PURGE.undoPurge();
ok('删一个不存在的 id **不会把待撤销的底稿冲掉**(否则那一下撤销就白问了)',
  u4.ok === true && C.listCustom().some((c) => c.id === back4.id));

console.log(fail ? `\n❌ ${fail} 个用例失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
