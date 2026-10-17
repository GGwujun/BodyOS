/**
 * 「今天练什么」小抄冒烟测试 —— 过期规则、脏数据降级、卡片上那句话怎么说。
 *
 * 这张小抄是训练分包留给主包首页的唯一一句话(主包读不到分包的 engine),
 * 所以它的两条底线值得单独钉住:
 *   1. **不是今天写的一律读不出来** —— 轮转、请假、练没练都是「今天」的函数,
 *      昨天下班前那份快照放到今早就全是错话;
 *   2. **怎么说都不许把用户送错地方** —— 快照坏了一半宁可只说「看今天的计划」,
 *      也不能拿着一个空的 dayKey 去开一次训练。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-digest.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** 假 storage:顺便盯住「存进去的到底是什么」 */
const store = new Map();
const Module = require('module');
const origLoad = Module._load;
/** 让 storage 开始抛错 —— 模拟真机上写不进去/storage 满了 */
let boom = false;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    const storage = {
      getStorageSync: (k) => {
        if (boom) throw new Error('storage 读不了');
        return store.has(k) ? store.get(k) : '';
      },
      setStorageSync: (k, v) => {
        if (boom) throw new Error('storage 写不了');
        store.set(k, v);
      },
      removeStorageSync: (k) => store.delete(k)
    };
    return { default: storage, ...storage };
  }
  return origLoad.call(this, req, ...rest);
};

const D = require('../.smoke/utils/training-digest.js');
const DT = require('../.smoke/utils/date.js');
const KEY = 'bodyos.training.today';

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const TEMPLATE = { state: 'todo', dayKey: 'd1', title: '推 · 胸肩三头', focus: '胸肩三头', estMin: 45, reassigned: false };

section('今天写的,今天读得出来');
store.clear();
D.saveTrainingDigest(TEMPLATE);
const today = D.loadTrainingDigest();
ok('读得回来', today != null);
ok('训练日带回来了', today.dayKey === 'd1' && today.title === '推 · 胸肩三头');
ok('处方细节带回来了', today.focus === '胸肩三头' && today.estMin === 45);
ok('状态带回来了', today.state === 'todo');
ok('日期是本地今天', today.date === DT.todayStr(), today.date);
ok('写进去的就是读出来的(落盘前没有偷偷改字段)', store.get(KEY).title === '推 · 胸肩三头');

section('隔天一律作废 —— 这张小抄的全部意义就在这一条');
ok('昨天的快照今天读不出来', D.loadTrainingDigest(DT.addDays(DT.todayStr(), 1)) === null);
ok('明天的快照今天也读不出来', D.loadTrainingDigest(DT.addDays(DT.todayStr(), -1)) === null);
store.set(KEY, { ...TEMPLATE, date: '2020-01-01' });
ok('过期就是 null,不是「拿到一份旧的自己小心」', D.loadTrainingDigest() === null);
ok('同一天换个日期参数才读得到', D.loadTrainingDigest('2020-01-01')?.dayKey === 'd1');

section('没写过 / 存的不是东西 / 认不出的状态 —— 都当没有,不能崩');
store.clear();
ok('全新设备没写过', D.loadTrainingDigest() === null);
for (const [name, v] of [
  ['存的不是对象', '随便一句话'],
  ['存的是数组', [TEMPLATE]],
  ['存的是 null', null],
  ['空对象(没有 date)', {}],
  ['date 不是字符串', { ...TEMPLATE, date: 20260101 }],
  ['date 是空串', { ...TEMPLATE, date: '' }],
  ['state 认不出来', { ...TEMPLATE, date: DT.todayStr(), state: 'raining' }],
  ['state 是空(老版本没这个字段)', { ...TEMPLATE, date: DT.todayStr(), state: undefined }]
]) {
  store.set(KEY, v);
  ok(name, D.loadTrainingDigest() === null);
}

section('字段坏一半:能救的救,救不了的不许编');
store.set(KEY, {
  date: DT.todayStr(), state: 'todo', dayKey: 42, title: null, focus: {}, estMin: '45', reassigned: 'yes'
});
const dirty = D.loadTrainingDigest();
ok('坏掉的字段退回空串,不写 undefined', dirty.dayKey === '' && dirty.title === '' && dirty.focus === '');
ok('estMin 是字符串 → 当 0(否则卡上会印「约 45 分钟」这种半对的话)', dirty.estMin === 0);
ok('reassigned 只认真 true,不认 "yes"', dirty.reassigned === false);
store.set(KEY, { ...TEMPLATE, date: DT.todayStr(), estMin: NaN });
ok('NaN 也是 0,别把 NaN 印到卡上', D.loadTrainingDigest().estMin === 0);
store.set(KEY, { ...TEMPLATE, date: DT.todayStr(), estMin: -5 });
ok('负数也是 0', D.loadTrainingDigest().estMin === 0);
store.set(KEY, { ...TEMPLATE, date: DT.todayStr(), reassigned: true });
ok('真 true 认', D.loadTrainingDigest().reassigned === true);

section('storage 罢工不能把首页/训练页带崩');
store.clear();
boom = true;
ok('写不进去不抛', (() => { try { D.saveTrainingDigest(TEMPLATE); return true; } catch { return false; } })());
ok('读不出来当没有', D.loadTrainingDigest() === null);
boom = false;

section('卡片上那句话 —— 五种情况各去各的地方');
store.clear();
const planView = '/pkg-exercise/plan-view/index';
const logs = '/pkg-exercise/log-history/index';
const viewOf = (d) => D.digestView(d);
const unknown = viewOf(null);
ok('今天是空白:不装作知道,只说去看计划', unknown.href === planView);
ok('空白也有话说(标题/副标题/按钮都不为空)', !!unknown.title && !!unknown.sub && !!unknown.action);
const none = viewOf({ ...TEMPLATE, state: 'none', dayKey: '', title: '', focus: '', estMin: 0 });
ok('没计划:送去生成计划', none.href === planView);
const todo = viewOf({ ...TEMPLATE, date: DT.todayStr() });
ok('该练了:一步开练,不走计划页中转', todo.href === `/pkg-exercise/workout/index?key=d1`, todo.href);
ok('按钮就叫「开始练」', todo.action === '开始练');
ok('标题里有今天要练的那套', todo.title.includes('推 · 胸肩三头'), todo.title);
ok('副标题是处方细节', todo.sub.includes('胸肩三头') && todo.sub.includes('45'), todo.sub);
const todoNoKey = viewOf({ ...TEMPLATE, date: DT.todayStr(), dayKey: '' });
ok('dayKey 是空的:宁可回计划页,也不拿空 key 去开一次训练', todoNoKey.href === planView, todoNoKey.href);
const reassigned = viewOf({ ...TEMPLATE, date: DT.todayStr(), reassigned: true });
ok('今天改练过就说出来', reassigned.sub.includes('改练'), reassigned.sub);
const done = viewOf({ ...TEMPLATE, state: 'done' });
ok('练完了:去看记录', done.href === logs);
ok('练完了的标题带训练日', done.title.includes('推 · 胸肩三头'));
const doneNoTitle = viewOf({ ...TEMPLATE, state: 'done', title: '' });
ok('练完了但没标题也不出半个句子', doneNoTitle.title === '今天练完了', doneNoTitle.title);
const off = viewOf({ ...TEMPLATE, state: 'off' });
ok('请假了:回计划页(销假在那儿)', off.href === planView);
ok('请假不说「该练了」', !off.title.includes('该练'), off.title);
ok('请假也告诉你下次练哪一套', off.sub.includes('下次练') && off.sub.includes('推 · 胸肩三头'), off.sub);
ok('不知道下次练什么就只说「不催你」', viewOf({ ...TEMPLATE, state: 'off', title: '' }).sub.includes('不催'));
ok('今天被改练过就不拿它当下一次', !viewOf({ ...TEMPLATE, state: 'off', reassigned: true }).sub.includes('下次练'));

section('周条 —— 这一周哪几天有说头');
// 周一为锚:utils/date.ts 里「一周从周一算」是全站唯一那份定义
const mon = DT.mondayOf(DT.todayStr());
const dots = [
  { d: mon, s: 'done' },
  { d: DT.addDays(mon, 1), s: 'off' },
  { d: DT.addDays(mon, 2), s: 'moved' }
];
store.clear();
D.saveTrainingDigest({ ...TEMPLATE, week: dots });
const wk = D.loadTrainingDigest();
ok('三个记号都带回来了', wk.week.length === 3, `拿到 ${wk.week.length} 个`);
ok('日期和状态没串', wk.week.map((x) => `${x.d}:${x.s}`).join() === dots.map((x) => `${x.d}:${x.s}`).join());
const dotMap = D.weekDotMap(wk);
ok('按日期取得到', dotMap[mon] === 'done' && dotMap[DT.addDays(mon, 1)] === 'off');
ok('没有记号的那天就不该有键', !(DT.addDays(mon, 3) in dotMap));
ok('没有小抄时给一张空表,不崩', Object.keys(D.weekDotMap(null)).length === 0);

section('周条上的脏数据:画不出来的不画(在别人本周的格子上多画一个点,比少画更糟)');
for (const [name, week, want] of [
  ['week 不是数组', '随便一句话', 0],
  ['week 是 null', null, 0],
  ['里面混了 null', [null, { d: mon, s: 'done' }], 1],
  ['状态认不出来', [{ d: mon, s: 'raining' }], 0],
  ['日期不是日期', [{ d: '明天', s: 'done' }], 0],
  ['别的周的日期', [{ d: DT.addDays(mon, -1), s: 'done' }, { d: DT.addDays(mon, 7), s: 'done' }], 0],
  ['同一天写了两遍', [{ d: mon, s: 'done' }, { d: mon, s: 'off' }], 1]
]) {
  store.set(KEY, { ...TEMPLATE, date: DT.todayStr(), week });
  ok(`${name} → 留 ${want} 个`, D.loadTrainingDigest().week.length === want);
}

section('练完那一刻不重算周条,但也不许把上一周的搬过来');
store.clear();
D.saveTrainingDigest({ ...TEMPLATE, week: dots });
// 训练页/补录走的就是这条:手上没有周条那份,不传 week
D.saveTrainingDigest({ state: 'done', dayKey: 'd1', title: '推 · 胸肩三头', focus: '胸肩三头', estMin: 45, reassigned: false });
const afterDone = D.loadTrainingDigest();
ok('练完回来周条还在(恰恰是最想看的时候)', afterDone.week.length === 3, `剩 ${afterDone.week.length} 个`);
ok('练完这件事本身也记下了', afterDone.state === 'done');
const nextMon = DT.addDays(mon, 7);
D.saveTrainingDigest({ ...TEMPLATE, date: nextMon });
ok('换了一周就不继承:旧的点落在上一周的格子上', D.loadTrainingDigest(nextMon).week.length === 0);

section('动作表 —— 训练 tab 要拿它列「今天要练的 N 个动作」');
store.clear();
D.saveTrainingDigest({ ...TEMPLATE, items: ['卧推', '上斜哑铃卧推', '绳索下压'] });
const withItems = D.loadTrainingDigest();
ok('动作名原样带回来', withItems.items.join() === '卧推,上斜哑铃卧推,绳索下压', withItems.items.join());
ok('老快照(没有 items)读出来是空表,不是 undefined', (() => {
  store.set(KEY, { ...TEMPLATE, date: DT.todayStr() });
  return Array.isArray(D.loadTrainingDigest().items) && D.loadTrainingDigest().items.length === 0;
})());
for (const [name, items, want] of [
  ['不是数组', '卧推', 0],
  ['里面混了 null / 数字 / 对象', [null, 42, {}, '卧推'], 1],
  ['空串和纯空格不算一个动作', ['', '   '], 0],
  ['前后空格会被去掉', ['  卧推  '], 1]
]) {
  store.set(KEY, { ...TEMPLATE, date: DT.todayStr(), items });
  ok(`${name} → 留 ${want} 个`, D.loadTrainingDigest().items.length === want);
}
store.set(KEY, { ...TEMPLATE, date: DT.todayStr(), items: ['卧' + '推'.repeat(60)] });
ok('超长的名字截断(快照是写进 storage 的一份,得有头)', D.loadTrainingDigest().items[0].length === 24);
store.set(KEY, { ...TEMPLATE, date: DT.todayStr(), items: Array.from({ length: 50 }, (_, i) => `动作${i}`) });
ok('最多留 30 个', D.loadTrainingDigest().items.length === 30);

section('动作表只在同一天里继承 —— 练完/补录那条路手上没有它');
store.clear();
D.saveTrainingDigest({ ...TEMPLATE, items: ['卧推', '划船'] });
// 训练页练完那一刻写的那一份(TEMPLATE 里没有 items)
D.saveTrainingDigest({ ...TEMPLATE, state: 'done' });
ok('同一天:练完回来动作表还在', D.loadTrainingDigest().items.length === 2);
const tomorrow = DT.addDays(DT.todayStr(), 1);
D.saveTrainingDigest({ ...TEMPLATE, date: tomorrow, state: 'done' });
ok('换了一天就不继承:昨天那几个动作名在今天是错的话', D.loadTrainingDigest(tomorrow).items.length === 0);

section('文案红线:卡片上的字不许出现 AI 那套词');
const banned = ['AI', '智能', '大模型', '智谱'];
const allWords = [
  unknown, none, todo, todoNoKey, reassigned, done, doneNoTitle, off
].flatMap((v) => [v.title, v.sub, v.action]);
ok('八种措辞全部干净', !allWords.some((w) => banned.some((b) => w.includes(b))));

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
