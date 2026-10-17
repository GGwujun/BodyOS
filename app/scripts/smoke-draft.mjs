/**
 * 「训练中这一场」草稿的冒烟测试 —— 存得下、读得回、坏的读不进来。
 *
 * 这份草稿补的是全站唯一一处**真的会丢数据**的地方:训练页的组数以前只活在页面内存里,
 * 小程序被系统回收 / 从小程序列表里划掉,那一场就无声消失(离开守卫拦的是主动离开那一类)。
 * 所以它值得被钉死的不是「功能对不对」,而是两条底线:
 *   1. **能救回来** —— 勾过的组、计时组的秒数、组型、热身打勾,一项都不能丢在存取之间;
 *   2. **坏数据读不进来** —— 它读回来的东西会直接进 `rows[ri].sets[si]` 的渲染。
 *      一份形状不对的草稿比「没有草稿」严重得多:没有草稿只是重练一遍,读坏了是整页打不开。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-draft.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** 假 storage:顺便数一下「到底写了几次」—— 去重是这套的关键行为 */
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

const D = require('../.smoke/utils/workout-draft.js');
const KEY = 'bodyos.workout-draft';

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);
/** 直接把一份东西塞进存储,绕过写入端的清洗(模拟手改/旧版本/半截写入) */
const inject = (obj) => { store.set(KEY, obj); };
const reset = () => { store.clear(); writes = 0; };

/** 一份正常的草稿(和训练页传上去的形状一致) */
const draftOf = (over = {}) => ({
  date: '2026-10-15',
  dayKey: 'd1',
  dayTitle: '推日',
  startedAt: Date.now() - 600000,
  rows: [
    {
      exerciseId: 'bench-press', nameZh: '卧推', patternId: 'horizontal-push',
      restSec: 90, weightStepKg: 2.5, isBodyweight: false, setType: 'normal',
      sets: [
        { reps: 8, weightKg: 60, done: true, rir: 2 },
        { reps: 8, weightKg: 60, done: false, rir: null },
        // 训练中按「＋ 加一组」多出来的那一组:它带着来路标记,恢复之后才撤得掉
        { reps: 8, weightKg: 60, done: false, rir: null, added: true }
      ]
    },
    {
      exerciseId: 'plank', nameZh: '平板支撑', patternId: 'core', restSec: 60, weightStepKg: 2.5,
      isBodyweight: true, setType: 'normal', holdSec: { min: 30, max: 60 },
      // 这个动作标了「这次不算进步」—— 恢复之后那一枚徽标得还在,
      // 否则用户接着练完,那一场会悄悄把他的下次目标改掉(而他已经排除过它了)
      noProg: true,
      sets: [{ reps: 0, weightKg: null, done: true, rir: null, sec: 45 }]
    }
  ],
  warmDone: ['0-0'],
  showEffort: true,
  sessionNote: '状态不错',
  noProg: false,
  weighed: true,
  ...over
});

section('存下去再读回来,一项都不能少');
{
  reset();
  D.saveDraft(draftOf());
  const d = D.loadDraft();
  ok('读得回来', !!d);
  ok('是哪一天/哪一套', d?.date === '2026-10-15' && d?.dayKey === 'd1' && d?.dayTitle === '推日');
  ok('两行都在', d?.rows.length === 2);
  ok('勾过的组还勾着', d?.rows[0].sets[0].done === true);
  ok('没勾的组也确实没勾', d?.rows[0].sets[1].done === false);
  // 来路标记丢了,恢复之后那一组就撤不掉了 —— 用户会一直看着一句「还有 1 组没完成」
  ok('临时加的那组还记得自己是加的', d?.rows[0].sets[2].added === true);
  ok('计划里本来就有的组没这个标记', d?.rows[0].sets[1].added === undefined && d?.rows[1].sets[0].added === undefined);
  ok('标了「这次不算进步」的动作恢复后还记得', d?.rows[1].noProg === true);
  ok('没标的动作不带这个字段(也不会被顺手标上)', d?.rows[0].noProg === undefined);
  ok('自感强度跟着走', d?.rows[0].sets[0].rir === 2);
  ok('计时组的实际秒数活着(45 秒的平板)', d?.rows[1].sets[0].sec === 45);
  ok('计时处方还在(那一行还知道自己是按时长练的)', d?.rows[1].holdSec?.max === 60);
  ok('热身打勾活着', d?.warmDone[0] === '0-0');
  ok('常驻备注/不算进步/体重都活着', d?.sessionNote === '状态不错' && d?.noProg === false && d?.weighed === true);
  /* 首页那句「已练 2/4 组」的分母把临时加的那组也算进去了 —— 和训练页底栏同一个口径
     (那边也是 `rows.reduce(…sets.length)`)。加了组就该说 4,撤掉了才回到 3 */
  ok('首页那行文案要的数对得上', D.draftBrief(d)?.sets === 2 && D.draftBrief(d)?.total === 4,
    `${D.draftBrief(d)?.sets}/${D.draftBrief(d)?.total}`);
}

section('一组都没勾 = 没在练(首页不为「看了一眼」摆继续)');
{
  reset();
  const d0 = draftOf();
  d0.rows[0].sets[0].done = false;
  d0.rows[1].sets[0].done = false;
  D.saveDraft(d0);
  ok('存是存进去了', store.has(KEY));
  ok('但读回来是空的', D.loadDraft() === null);
  ok('空草稿当然也没有「继续」那行文案', D.draftBrief(null) === null);
}

section('已经走了多久 —— 恢复时靠它把被打断那段扣掉');
{
  reset();
  D.saveDraft(draftOf({ startedAt: Date.now() - 600000 }));
  const d = D.loadDraft();
  ok('10 分钟前开练 → 约 600 秒', !!d && Math.abs(d.sec - 600) <= 2, `sec=${d?.sec}`);
}
{
  reset();
  D.saveDraft(draftOf({ startedAt: Date.now() }));
  ok('刚开练 → 0 秒左右', D.loadDraft()?.sec <= 1);
}

section('去重 —— 每一次点击都调它,内容没变就不该重复写存储');
{
  reset();
  D.saveDraft(draftOf());
  const after1 = writes;
  D.saveDraft(draftOf());                       // 一模一样(同一秒内)
  ok('同样的东西再来一次不写', writes === after1, `writes=${writes}`);
  const st = D.loadDraft();
  D.saveDraft(draftOf({ rows: st.rows.map((r, i) => i ? r : { ...r, sets: r.sets.map((s, j) => j ? s : { ...s, reps: 9 }) }) }));
  ok('内容变了就写', writes === after1 + 1, `writes=${writes}`);
}
{
  reset();
  const started = Date.now() - 10000;
  D.saveDraft(draftOf({ startedAt: started }));
  const before = writes;
  // 切后台那一趟:内容一个字没改,但时钟自己往前走了 —— 这一趟必须写得进去
  D.saveDraft(draftOf({ startedAt: started - 5 * 60 * 1000 }));
  ok('只走了时钟也要写得进去(否则恢复出来的时长永远停在最后一次勾组)', writes === before + 1);
  ok('而且秒数确实更新了', Math.abs((D.loadDraft()?.sec ?? 0) - 310) <= 2, `sec=${D.loadDraft()?.sec}`);
}

section('清掉 —— 结束训练那一刻');
{
  reset();
  D.saveDraft(draftOf());
  D.clearDraft();
  ok('存储里没了', !store.has(KEY));
  ok('也读不出来', D.loadDraft() === null);
  D.saveDraft(draftOf());
  ok('清完之后再存一份一样的内容,照样写得进去(去重的记录跟着一起清了)', store.has(KEY) && !!D.loadDraft());
}

section('「今天练完了」和草稿对账 —— 只认全勾完的同一场');
{
  const allDone = draftOf({
    rows: draftOf().rows.map((r) => ({ ...r, sets: r.sets.map((s) => ({ ...s, done: true })) }))
  });
  const digest = (over = {}) => ({ date: '2026-10-15', state: 'done', dayKey: 'd1', title: '推日', ...over });
  ok('同一场、全勾完、今天已记下 → 是残留', D.draftAlreadyDone(allDone, digest()) === true);
  ok('今天还没练完的快照 → 不动', D.draftAlreadyDone(allDone, digest({ state: 'todo' })) === false);
  ok('没有快照 → 不动', D.draftAlreadyDone(allDone, null) === false);
  ok('还没全勾完 → 不动(宁可留着也不误删没进日志的组)',
    D.draftAlreadyDone(draftOf(), digest()) === false);
  ok('不是同一天 → 不动', D.draftAlreadyDone(allDone, digest({ date: '2026-10-16' })) === false);
  ok('不是同一套 → 不动', D.draftAlreadyDone(allDone, digest({ dayKey: 'd2' })) === false);
  ok('合并训练的合成 key 拆开也能对上',
    D.draftAlreadyDone({ ...allDone, dayKey: 'a+b', dayKeys: ['a', 'b'] }, digest({ dayKey: 'a' })) === true);
  ok('快照 dayKey 坏了,同一天 + 同一套名 + 全勾完仍认得出',
    D.draftAlreadyDone(allDone, digest({ dayKey: '' })) === true);
  ok('dayKey 坏了、名字也对不上 → 不认', D.draftAlreadyDone(allDone, digest({ dayKey: '', title: '拉日' })) === false);
}

section('脏数据一律读不进来(读坏了是整页打不开,重练一遍反而轻)');
const bad = [
  ['根本不是对象', 'not-an-object'],
  ['缺 date', draftOf({ date: undefined })],
  ['date 不是 ISO', draftOf({ date: '昨天' })],
  ['缺 dayKey', draftOf({ dayKey: '' })],
  ['rows 不是数组', draftOf({ rows: {} })],
  ['rows 里混了 null', draftOf({ rows: [null] })],
  ['rows 是空的', draftOf({ rows: [] })],
  ['某一行的 sets 不是数组', draftOf({ rows: [{ ...draftOf().rows[0], sets: 3 }] })],
  ['某一行的 sets 是空的', draftOf({ rows: [{ ...draftOf().rows[0], sets: [] }] })],
  ['某一行没有 exerciseId', draftOf({ rows: [{ ...draftOf().rows[0], exerciseId: '' }] })],
  ['sets 里混了 null', draftOf({ rows: [{ ...draftOf().rows[0], sets: [null] }] })],
  ['startedAt 是 0(设备时钟错乱)', draftOf({ startedAt: 0 })],
  ['startedAt 是字符串', draftOf({ startedAt: '刚才' })],
  ['at 缺了', draftOf({ at: undefined })]
];
for (const [name, payload] of bad) {
  reset();
  inject(payload);
  ok(`拒收:${name}`, D.loadDraft() === null);
}

section('毛病只在个别字段上 → 收窄它,不要整份丢掉');
{
  reset();
  const d0 = draftOf();
  d0.rows[0].sets[0].reps = '八次';          // 次数不是数字
  d0.rows[0].sets[0].weightKg = 99999;       // 重量离谱
  d0.rows[0].restSec = -5;                   // 休息是负数
  d0.rows[0].weightStepKg = 0;               // 步长是 0
  d0.rows[1].holdSec = { min: 30 };          // 计时处方只有一半
  d0.warmDone = ['0-0', 'abc', 5, '1-2'];    // 热身 key 里混了别的
  d0.rows[1].noProg = '是的';                 // 「这次不算进步」不是布尔
  D.saveDraft(d0);
  const d = D.loadDraft();
  ok('这一份还在', !!d);
  ok('次数收成 0', d?.rows[0].sets[0].reps === 0, `${d?.rows[0].sets[0].reps}`);
  ok('重量收进上限', d?.rows[0].sets[0].weightKg === 1000, `${d?.rows[0].sets[0].weightKg}`);
  ok('负数休息收成 0', d?.rows[0].restSec === 0);
  ok('0 步长退回默认 2.5', d?.rows[0].weightStepKg === 2.5);
  ok('只有一半的计时处方整个丢掉(半个处方会让那一行算不出秒数)', d?.rows[1].holdSec === undefined);
  ok('热身 key 只留认得出来的那两个', JSON.stringify(d?.warmDone) === JSON.stringify(['0-0', '1-2']), JSON.stringify(d?.warmDone));
  ok('这一行仍然可以正常练(名字还在)', d?.rows[0].nameZh === '卧推');
  // 这一格不认识就当没标(**只丢这一格**,不整份丢):丢掉了顶多是「目标照常更新」,
  // 而整份丢掉的代价是那一场训练重练 —— 两害相权取轻的那个
  ok('认不出的「不算进步」标记当没标,不牵连这一份草稿', d?.rows[1].noProg === undefined);
}
{
  reset();
  D.saveDraft(draftOf({ sessionNote: 'x'.repeat(900) }));
  ok('超长备注被截断(存储是有限的)', (D.loadDraft()?.sessionNote.length ?? 0) === 500);
}

section('存储本身坏了也不许把训练页弄崩');
{
  reset();
  boom = true;
  let threw = false;
  try {
    D.saveDraft(draftOf());
    const got = D.loadDraft();
    ok('读不到就当没有', got === null);
    D.clearDraft();
  } catch {
    threw = true;
  }
  ok('写/读/清 三件事都不抛', !threw);
  boom = false;
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
