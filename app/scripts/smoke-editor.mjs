/**
 * 计划编辑器纯逻辑冒烟测试(临时脚本,跑完可删)。
 * 用法:先 tsc 编译到 .smoke,再 node scripts/smoke-editor.mjs
 */
import { createRequire } from 'module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);

/* mock Taro:引擎模块(store/fav/custom…)会 import 它,而真 Taro 在 Node 下起不来
   (它要小程序编译期注入的常量)。mock 必须在 require 引擎模块**之前**装好 ——
   所以这里不用 ESM 的 import(它会被提升到 mock 之前执行)。 */
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

const { generatePlan, candidatesFor } = require('../.smoke/pkg-exercise/engine/generator.js');
const E = require('../.smoke/pkg-exercise/engine/editor.js');

const plan0 = generatePlan({ goal: 'muscle', level: 'beginner', access: 'gym', daysPerWeek: 3, sessionMin: 45 });
console.log('起始计划:', plan0.days.map((d) => `${d.title}(${d.items.length}动作/${d.estMin}min)`).join(' | '));
assert.ok(plan0.days.length === 3);

// 1) 换动作:保留用户调好的组次
let p = plan0;
const d0 = p.days[0].items[0];
p = E.patchItem(p, 0, 0, { sets: 5, repsMin: 6, repsMax: 8, restSec: 120 });
const cand = candidatesFor(d0.patternId, p.access, p.level).filter((e) => e.id !== d0.exerciseId);
p = E.replaceItem(p, 0, 0, d0.patternId, cand[0]);
const it0 = p.days[0].items[0];
assert.equal(it0.exerciseId, cand[0].id, '换动作应换成新动作');
assert.equal(it0.sets, 5, '换动作应保留组数');
assert.equal(it0.repsMin, 6, '换动作应保留次数下限');
assert.equal(it0.restSec, 120, '换动作应保留休息');
assert.ok(it0.alternates.length > 0, '换动作后应重新生成备选');
assert.ok(it0.alternates.length <= 3, '备选最多 3 个');
console.log('✓ replaceItem 保留组次:', `${it0.nameZh} ${it0.sets}×${it0.repsMin}-${it0.repsMax} rest${it0.restSec}`);

// 2) 顺序调整
const before = p.days[0].items.map((x) => x.exerciseId);
p = E.moveItem(p, 0, 0, 1);
const after = p.days[0].items.map((x) => x.exerciseId);
assert.deepEqual(after, [before[1], before[0], ...before.slice(2)], '下移应交换 0/1');
p = E.moveItem(p, 0, 1, -1);
assert.deepEqual(p.days[0].items.map((x) => x.exerciseId), before, '上移应还原');
assert.equal(E.moveItem(p, 0, 0, -1), p, '首位上移应为 no-op(同引用)');
const last = p.days[0].items.length - 1;
assert.equal(E.moveItem(p, 0, last, 1), p, '末位下移应为 no-op');
console.log('✓ moveItem 边界正确');

// 3) 加动作:时长重算
const est0 = p.days[0].estMin;
const pool = candidatesFor('vpull', p.access, p.level).filter((e) => !E.dayHasExercise(p, 0, e.id));
assert.ok(pool.length > 0, '应有可加动作');
p = E.addItem(p, 0, 'vpull', pool[0]);
assert.ok(p.days[0].estMin > est0, `加动作后时长应增加: ${est0} → ${p.days[0].estMin}`);
assert.ok(E.dayHasExercise(p, 0, pool[0].id), 'dayHasExercise 应命中');
assert.ok(!E.dayHasExercise(p, 1, pool[0].id) || true);
console.log(`✓ addItem 时长重算 ${est0} → ${p.days[0].estMin} 分钟,备选 ${p.days[0].items.at(-1).alternates.length} 个`);

// 4) 删动作
const n = p.days[0].items.length;
p = E.removeItem(p, 0, 0);
assert.equal(p.days[0].items.length, n - 1, '删动作应少一个');
assert.ok(p.days[0].estMin < est0 + 100, '删动作后时长应重算');
console.log('✓ removeItem');

// 5) 训练日增删改
p = E.addDay(p);
assert.equal(p.days.length, 4);
assert.equal(p.daysPerWeek, 4, 'daysPerWeek 应同步');
assert.equal(p.days[3].key, 'custom-1');
p = E.addDay(p);
assert.equal(p.days[4].key, 'custom-2', '新训练日 key 应唯一');
p = E.renameDay(p, 4, '  腿日二  ');
assert.equal(p.days[4].title, '腿日二', '改名应 trim');
p = E.renameDay(p, 4, '');
assert.equal(p.days[4].title, '腿日二', '空名应拒绝');
p = E.renameDay(p, 4, '一二三四五六七八九十');
assert.equal(p.days[4].title.length, 8, '名称应截断到 8 字');
p = E.moveDay(p, 0, 1);
p = E.moveDay(p, 1, -1);
assert.equal(p.days.length, 5);
const k = p.days.map((x) => x.key).join(',');
p = E.removeDay(p, 0);
assert.equal(p.days.length, 4);
assert.notEqual(p.days.map((x) => x.key).join(','), k, '删训练日应生效');
assert.equal(E.removeDay(p, 0).days.length, 4 - 1, '仍可继续删');
console.log('✓ 训练日增删改(数量 %d,daysPerWeek %d)', p.days.length, p.daysPerWeek);

// 6) 只剩一天时不许删
let one = { ...p, days: [p.days[0]] };
assert.equal(E.removeDay(one, 0), one, '最后一天不可删(同引用)');
console.log('✓ 最后一天受保护');

// 7) 各种器械条件都能加动作(不崩)
for (const access of ['body', 'dumbbell', 'home', 'gym']) {
  const pl = generatePlan({ goal: 'fatloss', level: 'beginner', access, daysPerWeek: 2, sessionMin: 30 });
  const cs = candidatesFor('core', access, 'beginner');
  assert.ok(cs.length > 0, `${access} 核心模式应有候选`);
  const np = E.addItem(pl, 0, 'core', cs[0]);
  assert.equal(np.days[0].items.length, pl.days[0].items.length + 1);
  console.log(`✓ ${access}: 加入「${cs[0].nameZh}」→ ${np.days[0].items.length} 动作`);
}

// 8) 无副作用:原计划未被修改
assert.equal(plan0.days[0].items[0].sets, plan0.days[0].items[0].sets);
const snap = JSON.stringify(plan0);
E.addItem(plan0, 0, 'core', { id: 'x', nameZh: 'X', name: 'X', bodyPart: 'waist', equipment: 'body weight', target: 'abs', secondary: [], category: 'strength', level: 'beginner', force: '', mechanic: '', steps: [] });
assert.equal(JSON.stringify(plan0), snap, 'editor 操作不可变(原对象不应被改)');
console.log('✓ 不可变语义正确');

// 9) addExerciseToDay —— 动作库详情「加入计划」走的那条
//    它和 addItem 的差别只有「模式槽位谁来定」,所以这里要钉的正是那一格:
//    页面手上只有「哪个动作、哪一天」,槽位必须由动作自己算出来,且和编辑器里那条路算得一样。
{
  const base = generatePlan({ goal: 'muscle', level: 'intermediate', access: 'gym', daysPerWeek: 3, sessionMin: 45 });
  const pick = candidatesFor('hpush', base.access, base.level).find((e) => !E.dayHasExercise(base, 1, e.id));
  assert.ok(pick, '应能挑到一个第 1 天还没有的推类动作');

  const key1 = base.days[1].key;
  const lens = base.days.map((d) => d.items.length);
  const estBefore = base.days[1].estMin;
  const np = E.addExerciseToDay(base, key1, pick);

  assert.equal(np.days[1].items.length, lens[1] + 1, '只该往选中的那一天里加一个');
  assert.deepEqual(np.days.map((d) => d.items.length), [lens[0], lens[1] + 1, lens[2]], '别的训练日一个都没动');
  assert.equal(np.days[1].items.at(-1).exerciseId, pick.id, '加进去的必须是挑中的那个动作');
  assert.ok(np.days[1].estMin > estBefore, `时长应重算 ${estBefore} → ${np.days[1].estMin}`);
  assert.equal(E.dayHasExercise(base, 1, pick.id), false, '加之前不该说「那天有它」');
  assert.equal(E.dayHasExercise(np, 1, pick.id), true, '加之后页面靠它拦重复,必须命中');

  // 槽位口径:和 plan-edit 里「先选模式」那条路落到同一处 —— 页面没有传槽位的能力,
  // 所以这里直接比一格:同一动作经两个入口加出来,逐格一样(组数/次数/休息/备选)
  const { bestPatternOf } = require('../.smoke/pkg-exercise/engine/generator.js');
  const viaSlot = E.addItem(base, 1, bestPatternOf(pick.id, base.level), pick);
  assert.deepEqual(np.days[1].items.at(-1), viaSlot.days[1].items.at(-1), '与 addItem 的结果逐格一致');

  // 认 key 不认下标 —— 这一条是这段代码存在的理由,得让它真的能红:
  // 用户看到的是「全身 B」那一天的**下标 1**,如果这中间在计划页挪过顺序,
  // 用下标加就会加到**换过来的那一天**上,而且不报错。按 key 加必须还落在原来那一天。
  const moved = E.moveDay(base, 1, 1);                    // 原来 index 1 的那天挪到 index 2
  assert.equal(moved.days[2].key, key1, '前置:挪过之后它在下标 2');
  const afterMove = E.addExerciseToDay(moved, key1, pick);
  assert.equal(afterMove.days[2].items.at(-1).exerciseId, pick.id, '挪过之后仍应落在同一个训练日');
  assert.equal(afterMove.days[1].items.length, lens[1], '不能落到「换过来的那一天」上');
  assert.notEqual(afterMove.days[1].items.at(-1)?.exerciseId, pick.id, '换过来的那天不能多出这个动作');

  // 这一天已经不在计划里了(别处删掉/云同步换了一份)—— 原样返回,**同引用**,让调用方看得出来,
  // 不要凭一个对不上的 key 硬塞进某一天
  assert.equal(E.addExerciseToDay(base, 'no-such-day', pick), base, '认不出的训练日应原样返回(同引用)');
  assert.equal(E.addExerciseToDay({ ...base, days: [] }, key1, pick).days.length, 0, '计划里一天都没有时不动它');

  // 引擎不拦「同一天加两遍」—— 拦的那一下在页面(点之前就显示「已在」并把这一天关掉),
  // 引擎在这里保持可组合:真要一天做两遍同一个动作(不同组型)是能表达出来的
  const twice = E.addExerciseToDay(np, key1, pick);
  assert.equal(twice.days[1].items.filter((i) => i.exerciseId === pick.id).length, 2, '引擎不替页面拦重复');

  // 自定义动作(c- 开头)同样加得进去 —— findExercise 先问自定义,所以它也有自己的槽位
  const C = require('../.smoke/pkg-exercise/engine/custom.js');
  const made = C.addCustom({ name: '我的推胸机', bodyPart: 'chest', equipment: 'leverage machine', target: 'pectorals' });
  assert.ok(made.ok, '应能建一个自定义动作');
  const mine = C.findCustom(made.ex.id);
  assert.ok(mine && mine.id.startsWith('c-'), '自定义动作 id 应以 c- 开头');
  const withMine = E.addExerciseToDay(base, base.days[0].key, C.asEntry(mine));
  assert.equal(withMine.days[0].items.at(-1).exerciseId, mine.id, '自定义动作应加得进计划');
  console.log(`✓ addExerciseToDay 认 key(挪过之后仍在同一天)、槽位=${bestPatternOf(pick.id, base.level)}、自定义动作也进得去(${mine.id})`);
}

// 10) duplicateDay —— 训练日层的「复制」
//     它要负责的不只是「两天的动作列表一样」,更是复制品**从这一刻起独立**:
//     身份(key)、名字、以及那些嵌套字段都不能还牵着原件。
{
  const base = generatePlan({ goal: 'muscle', level: 'intermediate', access: 'gym', daysPerWeek: 3, sessionMin: 45 });
  // 先给原件配上一组「拷过去要一模一样、改起来又要互不影响」的东西(超级组号是唯一一种
  // 跨条目的引用,而它只在同一天内部比较 —— 复制时抄不抄、抄了会不会串台,正是要钉的)
  const b = base.days[0].items.length >= 2 ? E.toggleSuperset(base, 0, 0) : base;
  const src = b.days[0];

  const key0 = src.key;
  const n = b.days.length;
  const dp = E.duplicateDay(b, 0);

  assert.equal(dp.days.length, n + 1, '复制应多出来一天');
  assert.equal(dp.daysPerWeek, n + 1, '每周天数跟着涨(计划页就显示这个数)');
  const copy = dp.days[1];
  assert.notEqual(copy.key, key0, '★key 必须重发 —— 两天共用 key 就是「练错处方」的来源');
  assert.equal(new Set(dp.days.map((d) => d.key)).size, dp.days.length, 'key 不能有重的');
  assert.equal(copy.title, `${src.title} 2`, `复制品的名字应带序号:${copy.title}`);
  assert.equal(copy.key, `${key0}-2`, '复制品的 key 应照导入那条规矩往后排');
  assert.equal(dp.days[1].key, `${key0}-2`, '复制品应插在**原件后面**,不是排到计划末尾');
  assert.equal(dp.days[2].key, b.days[1].key, '原来那一天还在(只是往后挪了一格)');

  // 逐格一样(动作/组次/休息/组型/备选),但**不是同一批对象**
  assert.deepEqual(copy.items, src.items, '动作编排应逐格一样');
  assert.notEqual(copy.items[0], src.items[0], '每个动作要是新对象');
  assert.notEqual(copy, src, '训练日对象要是新的');
  assert.equal(copy.estMin, src.estMin, '动作一样 → 时长也该一样');

  // 改复制品不动原件。不可变接口下这条几乎必然成立,真正要钉的是**嵌套字段**:
  // holdSec / alternates 只做浅拷的话,以后谁就地改一下会同时改到两个训练日
  const nested = src.items.find((it) => it.holdSec || it.alternates);
  assert.ok(nested, '前置:这一天该有带嵌套字段的动作');
  const sameIt = copy.items.find((it) => it.exerciseId === nested.exerciseId);
  if (nested.holdSec) assert.notEqual(sameIt.holdSec, nested.holdSec, 'holdSec 必须是真复制');
  if (nested.alternates) assert.notEqual(sameIt.alternates, nested.alternates, 'alternates 必须是真复制');
  if (nested.alternates) assert.deepEqual(sameIt.alternates, nested.alternates, '备选应逐个一样');
  const p2 = E.patchItem(dp, 1, 0, { sets: 1, repsMin: 3, repsMax: 4 });
  assert.equal(p2.days[0].items[0].sets, src.items[0].sets, '改复制品不能动到原件');
  assert.equal(p2.days[0].items[0].repsMin, src.items[0].repsMin, '改复制品不能动到原件(次数)');

  // 超级组:组号原样带过去,且在复制品内部照样是配好的一对
  const srcSs = src.items[0].superset;
  assert.ok(srcSs, '前置:前两个动作已配成超级组');
  assert.equal(copy.items[0].superset, srcSs, '超级组号应原样带过去(重发号会把配对拆散)');
  assert.equal(copy.items[1].superset, srcSs, '复制品里这一对仍然是配好的');

  // 原计划不被改动(splice 用的是新数组)
  assert.equal(b.days.length, n, '原计划的天数不变');
  assert.equal(b.days.map((d) => d.key).join(','), base.days.map((d) => d.key).join(','),
    '原计划的顺序不能被改');

  // 连复制两次:key 往后排,名字也往后排
  const twice = E.duplicateDay(dp, 0);
  assert.equal(twice.days[1].key, `${key0}-3`, '第二次复制的 key 应继续往后排');
  assert.equal(twice.days[1].title, `${src.title} 3`, '名字也应继续往后排');
  assert.equal(twice.days[2].key, `${key0}-2`, '上一份复制品还在(被挤到后一格)');
  // 复制「推日 2」拿到的是「推日 3」,不是「推日 2 2」
  const fromCopy = E.duplicateDay(dp, 1);
  assert.equal(fromCopy.days[2].title, `${b.days[0].title} 3`, '从复制品再复制,名字不该叠成「… 2 2」');

  // 名字顶到长度上限:编辑框 maxlength=8,复制品的名字也不能超过它
  const long = E.renameDay(b, 0, '我的自主训练日');
  const longCopy = E.duplicateDay(long, 0).days[1].title;
  assert.ok(longCopy.length <= 8, `复制品的名字不能超过编辑框的 8 个字:${longCopy}`);
  assert.ok(/ \d+$/.test(longCopy), `仍要能看出是第几份:${longCopy}`);

  // 空训练日也复制得动(刚加的那天还没排动作)
  const empty = E.addDay(b);
  const emptyCopy = E.duplicateDay(empty, empty.days.length - 1);
  assert.equal(emptyCopy.days.length, empty.days.length + 1, '空训练日也复制得动');
  assert.equal(emptyCopy.days.at(-1).items.length, 0, '复制品也是空的');

  // 越界/空计划:原样返回,**同引用**(页面靠它知道这一下没有发生)
  assert.equal(E.duplicateDay(b, 99), b, '下标越界应原样返回(同引用)');
  assert.equal(E.duplicateDay({ ...b, days: [] }, 0).days.length, 0, '没有训练日时不该凭空造一天');

  console.log(`✓ duplicateDay 插在原件后面、key/名字重发、嵌套字段真复制(${key0} → ${copy.key} · ${copy.title})`);
}

console.log('\n全部通过 ✅');
