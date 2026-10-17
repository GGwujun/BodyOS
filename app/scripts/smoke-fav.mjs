/**
 * M10.2 收藏动作 冒烟测试 —— 收藏表的清洗、加/取消、以及**排序口径**
 * (排序是这东西的全部价值:1324 条动作里把「我常做的那几个」顶上来)。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-fav.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** 假 storage:收藏要存得住、读得回来 */
const store = new Map();
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    // `default` 那份不能省:编译产物是 __importDefault(require(...))
    const storage = {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => store.set(k, v),
      removeStorageSync: (k) => store.delete(k)
    };
    return { default: storage, ...storage };
  }
  return origLoad.call(this, req, ...rest);
};

const F = require('../.smoke/pkg-exercise/engine/fav.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/** 造日志:一次训练练了哪些动作 */
const log = (date, ids) => ({
  id: date, planId: 'p1', dayKey: 'a', dayTitle: '', date,
  entries: ids.map((id) => ({ exerciseId: id, nameZh: id, sets: [{ reps: 8, weightKg: 20, rir: 2 }] }))
});
/** 造动作库条目(排序只看 id) */
const ex = (id) => ({ id, nameZh: id });
const ids = (list) => list.map((e) => e.id).join(',');

section('收藏表的清洗');
ok('不是数组 → 空', F.sanitizeFavs(null).length === 0 && F.sanitizeFavs({}).length === 0 && F.sanitizeFavs('a').length === 0);
ok('去掉空的不是字符串的', F.sanitizeFavs(['a', '', null, 42, 'b']).join(',') === 'a,b');
ok('去重但保序(顺序有意义)', F.sanitizeFavs(['b', 'a', 'b']).join(',') === 'b,a');
ok(`最多 ${F.FAV_CAP} 条(再多就不是「我常做的」,是第二份动作库)`,
  F.sanitizeFavs(Array.from({ length: F.FAV_CAP + 50 }, (_, i) => `e${i}`)).length === F.FAV_CAP);
ok('不认的输入不会抛异常', Array.isArray(F.sanitizeFavs(undefined)));

section('加 / 取消收藏');
ok('加进去', F.toggleFav([], 'a').join(',') === 'a');
ok('新加的排最后(星完回列表时整组不会跳位)', F.toggleFav(['a'], 'b').join(',') === 'a,b');
ok('再点一次就是取消', F.toggleFav(['a', 'b'], 'a').join(',') === 'b');
ok('空 id 原样返回(界面上误点不该写进一条空收藏)', (() => {
  const f = ['a'];
  return F.toggleFav(f, '') === f;
})());
ok('不改原数组(调用方直接 setState)', (() => {
  const f = ['a'];
  F.toggleFav(f, 'b');
  return f.join(',') === 'a';
})());
ok('存进去的是清洗过的(重复的 id 不会越攒越多)', F.toggleFav(['a', 'a'], 'b').join(',') === 'a,b');
ok('isFav', F.isFav(['a'], 'a') === true && F.isFav(['a'], 'b') === false);

section('存取');
store.clear();
ok('空的时候读出来是空数组', F.loadFavs().length === 0);
F.saveFavs(['a', 'b']);
ok('落到 storage 里了', store.get('bodyos.training.favs')?.join(',') === 'a,b');
ok('读得回来', F.loadFavs().join(',') === 'a,b');
ok('写了就记一笔修改时间(云同步靠它判先后)', !!store.get('bodyos.sync.marks')?.['favs|main']);
store.set('bodyos.training.favs', '不是数组');
ok('storage 里躺着脏数据也不炸', F.loadFavs().length === 0);
store.set('bodyos.training.favs', ['a', null, 'a', 'b']);
ok('存之前没洗过的数据,读的时候也洗一遍', F.loadFavs().join(',') === 'a,b');

section('常用次数从日志里数');
ok('练过两次就是 2', F.usageOf([log('d1', ['a']), log('d2', ['a', 'b'])]).a === 2);
ok('没练过的动作不在表里(不是 0)', F.usageOf([log('d1', ['a'])]).b === undefined);
ok('同一次里同一个动作出现两回只算一次', F.usageOf([log('d1', ['a', 'a'])]).a === 1);
ok('空日志/脏日志不炸', Object.keys(F.usageOf([])).length === 0 && Object.keys(F.usageOf([null, {}, { entries: null }])).length === 0);
ok('补录的也算(「我做过这个动作」跟数据来源无关)', F.usageOf([{ ...log('d1', ['a']), manual: true }]).a === 1);

section('排序:收藏优先 → 常练优先 → 保持原顺序');
const LIB = [ex('a'), ex('b'), ex('c'), ex('d')];
ok('收藏的排最前', ids(F.sortedByFav(LIB, ['c'], {})) === 'c,a,b,d');
ok('两个收藏之间:练得多的排前面', ids(F.sortedByFav(LIB, ['c', 'd'], { c: 1, d: 9 })) === 'd,c,a,b');
ok('收藏内部练过一样多时,按加入收藏的顺序', ids(F.sortedByFav(LIB, ['c', 'd'], {})) === 'c,d,a,b');
ok('没收藏的人里,练得多的排前面', ids(F.sortedByFav(LIB, [], { b: 5, d: 3 })) === 'b,d,a,c');
ok('都没练过时,一个都不动(顺序稳定,不许乱排)', ids(F.sortedByFav(LIB, [], {})) === 'a,b,c,d');
ok('收藏但没练过,仍然排在「练过但没收藏」前面', (() => {
  // 用户显式认下的动作,比算法猜出来的常用更算数
  const r = ids(F.sortedByFav(LIB, ['d'], { a: 9, b: 8, c: 7 }));
  return r === 'd,a,b,c';
})());
ok('不改原数组', (() => {
  const before = ids(LIB);
  F.sortedByFav(LIB, ['d'], { a: 9 });
  return ids(LIB) === before;
})());
ok('列表里有收藏表里不存在的 id 也无所谓(动作库换过版本)', (() => {
  return ids(F.sortedByFav(LIB, ['zzz', 'b'], {})) === 'b,a,c,d';
})());

section('列表第二行那句话');
ok('练过就说次数', F.usageText(12) === '练过 12 次');
ok('没练过/脏值就是空串(不显示一行「练过 0 次」)', F.usageText(0) === '' && F.usageText(undefined) === '' && F.usageText(-3) === '');

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
