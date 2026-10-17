/**
 * M10.5 单侧动作(次数按两侧合计记)冒烟测试。
 *
 * 这条链路上只有一个口径:**次数 = 两侧合计**。计划里存 16-20,显示「每侧 8-10」,
 * 录入按 2 递增,日志里 24 就是每侧 12。所以这套用例只盯四件事:
 *   1. 哪些动作算单侧(判定不能把「横叉式深蹲」和「侧躺拉伸」也算进来);
 *   2. 折算对不对(evenReps / sideReps / rescaleReps / 那些文本函数);
 *   3. **容量一处都不用改**(合计口径下 reps×重量 天然就是两侧真实做的功);
 *   4. **必须折的那一处是 1RM** —— 折了才有纪录/基准,不折就是悄悄一条都没有。
 * 第 4 条是这套用例存在的理由:它错起来不报错,只是「这个动作一直没有成绩」。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-sided.mjs
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

const E = '../.smoke/pkg-exercise/engine/';
const T = require(`${E}types.js`);
const S = require(`${E}sided.js`);
const O = require(`${E}onerm.js`);
const H = require(`${E}history.js`);
const M = require(`${E}max.js`);
const ST = require(`${E}settype.js`);
const W = require(`${E}warmup.js`);
const G = require(`${E}generator.js`);
const ED = require(`${E}editor.js`);
const PROG = require(`${E}progression.js`);
const SC = require(`${E}share-card.js`);

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const ex = (id) => G.findExercise(id);

/* 用例里用到的真实动作(全部来自 1,324 条动作库) */
const ONE_ARM_ROW = '0292';   // dumbbell one arm bent-over row — 单臂划船,哑铃
const BENCH = '0025';         // barbell bench press — 双侧
const LUNGE = '1460';         // walking lunge — 弓步,徒手
const HEEL_TAP = '0006';      // alternate heel touchers — 交替,徒手
const SIDE_SPLIT = '0098';    // barbell side split squat — **不是**单侧(横叉式宽站距,两腿一起蹲)
const DOUBLE_WINDMILL = '0530'; // kettlebell double windmill — **不是**单侧(双手一起)
const SIDE_STRETCH = '1358';  // side lying floor stretch — 名字里有 side,但不是单侧动作

const set = (reps, weightKg, rir = 2) => ({ reps, weightKg, rir });
const logOf = (date, entries, extra = {}) => {
  const sets = entries.flatMap((e) => e.sets);
  return {
    id: `wo-${date}`, planId: 'p', dayKey: 'd', dayTitle: '练', date,
    durationSec: 3600,
    totalSets: sets.length,
    totalReps: sets.reduce((n, s) => n + s.reps, 0),
    totalVolumeKg: O.round2(sets.reduce((n, s) => n + s.reps * (s.weightKg ?? 0), 0)),
    avgRir: null,
    entries,
    ...extra
  };
};

/* ================= 哪些动作算单侧 ================= */
section('判定:名字里怎么说才是一次只练一边');
ok('单臂划船 → 单侧', S.isSided(ONE_ARM_ROW) === true);
ok('杠铃卧推 → 双侧', S.isSided(BENCH) === false);
ok('弓步 → 单侧', S.isSided(LUNGE) === true);
ok('交替触地 → 单侧', S.isSided(HEEL_TAP) === true);
// 这两条是判定的陷阱:名字里都有单侧的字眼,做起来却是两边一起
ok('横叉式宽站距深蹲(side split squat)→ 双侧', S.isSided(SIDE_SPLIT) === false, ex(SIDE_SPLIT).nameZh);
ok('双手风车(double windmill)→ 双侧', S.isSided(DOUBLE_WINDMILL) === false, ex(DOUBLE_WINDMILL).nameZh);
ok('侧躺拉伸(名字里有 side)→ 双侧', S.isSided(SIDE_STRETCH) === false, ex(SIDE_STRETCH).nameZh);
ok('不认识的 id 不炸也不当单侧', S.isSided('__nope__') === false && S.isSided('') === false);

/* ================= 折算 ================= */
section('折算:偶数、每侧、来回折');
ok('奇数取偶(15 → 16)', T.evenReps(15) === 16, String(T.evenReps(15)));
ok('偶数不动(16 → 16)', T.evenReps(16) === 16);
ok('下限是 2(1 → 2),不会折出 0 次', T.evenReps(1) === 2 && T.evenReps(0) === 2);
ok('折半:24 → 每侧 12', T.sideReps(24, true) === 12 && T.sideReps(24, false) === 24);
ok('合计是奇数就照实说 11.5(不四舍五入)', T.sideReps(23, true) === 11.5);
ok('说人话:24 → 「12」,23 → 「11.5」', S.sideRepsText(24) === '12' && S.sideRepsText(23) === '11.5');
ok('计划那一行:16-20 次(每侧 8-10)', S.sideRangeText(16, 20, true) === '16-20 次(每侧 8-10)', S.sideRangeText(16, 20, true));
ok('双侧那一行原样(不加括号)', S.sideRangeText(16, 20, false) === '16-20 次', S.sideRangeText(16, 20, false));
ok('上下限相同时不写成 20-20', S.sideRangeText(20, 20, true) === '20 次(每侧 10)', S.sideRangeText(20, 20, true));
ok('步长:单侧走 2,双侧走 1', S.repStepOf(true) === 2 && S.repStepOf(undefined) === 1);
{
  // 来回折一次要能回到原地 —— 编辑器里点错开关再点回来,数字不能变形
  ok('打开:12 → 24(每侧还是 12)', S.rescaleReps(12, true) === 24, String(S.rescaleReps(12, true)));
  ok('关掉:24 → 12', S.rescaleReps(24, false) === 12, String(S.rescaleReps(24, false)));
  ok('来回一圈等于没动', S.rescaleReps(S.rescaleReps(12, true), false) === 12);
  ok('关掉时折出奇数也照实取整(25 → 13)', S.rescaleReps(25, false) === 13, String(S.rescaleReps(25, false)));
  ok('纪录那一行的说法:每侧 12 / 12', S.sideRepsLabel(ONE_ARM_ROW, 24) === '每侧 12' && S.sideRepsLabel(BENCH, 24) === '24',
    `${S.sideRepsLabel(ONE_ARM_ROW, 24)} / ${S.sideRepsLabel(BENCH, 24)}`);
}

/* ================= 容量:一处都不用改 ================= */
section('容量不用改 —— 合计口径下 reps × 重量 就是两侧真实做的功');
{
  // 每侧 12 次 × 30kg,合计 24 次:真实做功 = 12×30 + 12×30 = 720
  const log = logOf('2026-10-01', [{ exerciseId: ONE_ARM_ROW, nameZh: '单臂划船', sets: [set(24, 30), set(24, 30), set(24, 30)] }]);
  const sum = H.summaryOf([log]);
  ok('单侧动作的容量照旧是 reps × 重量(3 组 × 24 × 30 = 2160)', sum.volumeKg === 2160, String(sum.volumeKg));
  ok('总次数也是合计口径(72)', sum.reps === 72, String(sum.reps));
  ok('同样的两次训练容量翻倍 —— 没有哪一步在偷偷折半', H.summaryOf([log, { ...log, id: 'x', date: '2026-10-02' }]).volumeKg === 4320);
}

/* ================= 1RM:必须折的那一处 ================= */
section('1RM 折算:不折就没有任何纪录和基准');
ok('合计 24 次(每侧 12)能算出 1RM', O.e1rmOf(30, 24, true) > 0, String(O.e1rmOf(30, 24, true)));
ok('算出来的就是「每侧 12 次」那个值', O.e1rmOf(30, 24, true) === O.estimate1RM(30, 12), `${O.e1rmOf(30, 24, true)} vs ${O.estimate1RM(30, 12)}`);
ok('拿合计去套 12 次上限 → 一条都没有(不折的下场)', O.e1rmOf(30, 24, false) === 0, String(O.e1rmOf(30, 24, false)));
ok('每侧 10 次(fatigue 上限内)算得出', O.e1rmOf(30, 20, true) > 0);
ok('每侧 13 次超过上限 → 不算(照旧是 0)', O.e1rmOf(30, 26, true) === 0);
ok('双侧动作口径没被动过(13 次仍是 0)', O.e1rmOf(30, 13, false) === 0);
{
  const sets = [set(20, 30), set(20, 30), set(20, 30)]; // 每侧 10 次
  ok('基准估算:单侧动作能给基准', M.bestE1rmOf(sets, true) > 0, String(M.bestE1rmOf(sets, true)));
  ok('同一组数按双侧判 → 一个基准都没有(旧行为)', M.bestE1rmOf(sets, false) === 0);
  const m = M.syncMaxes([logOf('2026-10-01', [{ exerciseId: ONE_ARM_ROW, nameZh: '单臂划船', sets }])], {});
  ok('日志扫一遍就能给出「训练最大重量」', !!m[ONE_ARM_ROW] && m[ONE_ARM_ROW].e1rmKg > 0, JSON.stringify(m[ONE_ARM_ROW] || null));
  ok('训练最大重量仍是估算值的九成', m[ONE_ARM_ROW].tmKg === O.round2(m[ONE_ARM_ROW].e1rmKg * 0.9));
}

/* ================= 纪录与曲线 ================= */
section('纪录:单侧动作也进纪录,且 1RM 是折算后的');
{
  const sets = [set(24, 30), set(24, 30), set(24, 30)];
  const sided = logOf('2026-10-01', [{ exerciseId: ONE_ARM_ROW, nameZh: '单臂划船', sets }]);
  const bilateral = logOf('2026-10-01', [{ exerciseId: BENCH, nameZh: '杠铃卧推', sets }]);
  const prSide = H.personalRecords([sided]).find((p) => p.exerciseId === ONE_ARM_ROW);
  const prBi = H.personalRecords([bilateral]).find((p) => p.exerciseId === BENCH);
  ok('单侧动作有纪录', !!prSide && prSide.topKg === 30, JSON.stringify(prSide || null));
  ok('单侧动作的纪录带 1RM(折过)', prSide.bestE1rm > 0, String(prSide.bestE1rm));
  ok('同样的 24 次,双侧动作不给 1RM(超 12 次)', prBi.bestE1rm === 0, String(prBi.bestE1rm));
  const pts = H.exerciseHistory([sided], ONE_ARM_ROW);
  ok('曲线上的点也是折过的 1RM', pts.length === 1 && pts[0].bestE1rm === prSide.bestE1rm, JSON.stringify(pts[0]));
}

/* ================= 组型展开 ================= */
section('组型:每组目标次数落在偶数上');
{
  const base = { sets: 4, repsMin: 16, repsMax: 24, weightKg: 40, sided: true };
  const pyr = ST.expandSets(base, 'pyramid');
  ok('金字塔逐组插值也全是偶数(每侧才分得匀)', pyr.every((s) => s.reps % 2 === 0 && s.reps >= 2), JSON.stringify(pyr.map((s) => s.reps)));
  // 金字塔是「轻的多做、重的少做」:首组吃区间上限,末组吃下限
  ok('金字塔首组 = 上限、末组 = 下限(轻的多做)', pyr[0].reps === 24 && pyr[pyr.length - 1].reps === 16, JSON.stringify(pyr.map((s) => s.reps)));
  ok('金字塔的重量仍是逐组递增的', pyr.every((s, i) => i === 0 || (s.weightKg > pyr[i - 1].weightKg)));
  const back = ST.expandSets(base, 'backoff');
  ok('降重收尾那组也是偶数', back[back.length - 1].reps % 2 === 0, String(back[back.length - 1].reps));
  const fail2 = ST.expandSets(base, 'failure');
  ok('力竭组同样是偶数', fail2.every((s) => s.reps % 2 === 0));
  const bi = ST.expandSets({ ...base, sided: undefined }, 'pyramid');
  ok('双侧动作的展开一个字都没变(还是逐组递减的自然数)', bi.map((s) => s.reps).join(',') === '24,21,19,16', bi.map((s) => s.reps).join(','));
}

/* ================= 热身 ================= */
section('热身:表里的次数按「每侧」写,合计口径要翻倍');
{
  const bi = W.warmupSets(60, 2.5, 3, false);
  const si = W.warmupSets(60, 2.5, 3, true);
  ok('组数与重量不变', si.length === bi.length && si.every((s, i) => s.weightKg === bi[i].weightKg));
  ok('次数翻倍(8/5 变成 16/10)', si.map((s) => s.reps).join(',') === bi.map((s) => s.reps * 2).join(','), si.map((s) => s.reps).join(','));
  ok('翻完显示出来是整数每次(不会出现「每侧 2.5 次」)', si.every((s) => Number.isInteger(s.reps / 2)));
  ok('不传这个参数时行为不变', W.warmupSets(60, 2.5, 3).map((s) => s.reps).join(',') === bi.map((s) => s.reps).join(','));
}

/* ================= 生成 / 换动作 ================= */
section('生成与编辑器:加进来的单侧动作自带正确口径');
{
  const it = G.buildItem('hpull', ex(ONE_ARM_ROW), 'muscle');
  ok('单臂划船装进计划就标了单侧', it.sided === true);
  ok('次数翻成合计并取偶(8-12 → 16-24)', it.repsMin === 16 && it.repsMax === 24, `${it.repsMin}-${it.repsMax}`);
  ok('显示出来正是方案表里的每侧 8-12', S.sideRangeText(it.repsMin, it.repsMax, it.sided) === '16-24 次(每侧 8-12)', S.sideRangeText(it.repsMin, it.repsMax, it.sided));
  const bench = G.buildItem('hpush', ex(BENCH), 'muscle');
  ok('双侧动作不带这个标记(老计划一行都不用改)', bench.sided === undefined && bench.repsMin === 8, `${bench.sided}/${bench.repsMin}`);
}
{
  // 换动作:双侧 ↔ 单侧时,用户已经调过的次数要跟着折,不然处方会无声地差一倍
  const plan = {
    id: 'p', createdAt: 'x', goal: 'muscle', level: 'beginner', access: 'dumbbell',
    daysPerWeek: 1, sessionMin: 40, doneCount: 0, lastNote: 'x',
    days: [{
      key: 'a', title: '全身', focus: '', estMin: 40,
      items: [{ exerciseId: BENCH, nameZh: '杠铃卧推', patternId: 'hpull', sets: 3, repsMin: 12, repsMax: 12, weightKg: 30, weightStepKg: 2.5, restSec: 90, progression: 'double', alternates: [] }]
    }]
  };
  const toSided = ED.replaceItem(plan, 0, 0, 'hpull', ex(ONE_ARM_ROW));
  const s1 = toSided.days[0].items[0];
  ok('换成单臂划船:次数跟着翻成合计(12 → 24)', s1.repsMin === 24 && s1.repsMax === 24, `${s1.repsMin}-${s1.repsMax}`);
  ok('换成单侧后打上了标记', s1.sided === true);
  ok('每侧还是 12 次(用户看到的处方没变)', S.sideRepsText(s1.repsMin) === '12');
  const back = ED.replaceItem(toSided, 0, 0, 'hpush', ex(BENCH));
  const s2 = back.days[0].items[0];
  ok('再换回双侧:次数折回 12', s2.repsMin === 12 && s2.repsMax === 12 && s2.sided === undefined, `${s2.repsMin}-${s2.repsMax}/${s2.sided}`);
  ok('来回换一圈,数字回到起点', s2.repsMin === plan.days[0].items[0].repsMin);
  ok('组数/休息这些用户调过的照旧保留', s2.sets === 3 && s2.restSec === 90);
}

/* ================= 渐进 ================= */
section('渐进:写回去的目标次数也必须是偶数');
{
  const plan = {
    id: 'p', createdAt: 'x', goal: 'endurance', level: 'beginner', access: 'none',
    daysPerWeek: 1, sessionMin: 40, doneCount: 0, lastNote: 'x',
    days: [{
      key: 'a', title: '腿', focus: '', estMin: 40,
      items: [{ exerciseId: LUNGE, nameZh: '行走弓步', patternId: 'lunge', sets: 3, repsMin: 18, repsMax: 22, weightKg: null, weightStepKg: 0, restSec: 60, progression: 'ladder', alternates: [], sided: true }]
    }]
  };
  const hit = [{ exerciseId: LUNGE, sets: Array.from({ length: 3 }, () => ({ reps: 22, weightKg: null, done: true, rir: 2 })) }];
  const r = PROG.applyWorkout(plan, 'a', hit, 2400, {});
  const st = r.next[LUNGE];
  ok('次数阶梯往上走 2(22 → 24,合计口径)', st.repsMin === 20 && st.repsMax === 24, `${st.repsMin}-${st.repsMax}`);
  ok('写回去的是偶数(不会出现「每侧 12.5 次」)', st.repsMin % 2 === 0 && st.repsMax % 2 === 0);
  ok('给用户看的话说的是每侧', (r.notes[0] || '').includes('每侧 12'), r.notes[0]);
}
{
  // 连续两次没达标 → 徒手目标回退;回退后的目标也得是偶数
  const plan = {
    id: 'p', createdAt: 'x', goal: 'endurance', level: 'beginner', access: 'none',
    daysPerWeek: 1, sessionMin: 40, doneCount: 0, lastNote: 'x',
    days: [{
      key: 'a', title: '腿', focus: '', estMin: 40,
      items: [{ exerciseId: LUNGE, nameZh: '行走弓步', patternId: 'lunge', sets: 3, repsMin: 18, repsMax: 22, weightKg: null, weightStepKg: 0, restSec: 60, progression: 'ladder', alternates: [], sided: true }]
    }]
  };
  const miss = [{ exerciseId: LUNGE, sets: Array.from({ length: 3 }, () => ({ reps: 14, weightKg: null, done: true, rir: 2 })) }];
  // 先失败一次(带失败计数),再失败一次触发回退
  const prev = { [LUNGE]: { exerciseId: LUNGE, weightKg: null, repsMin: 18, repsMax: 22, sets: 3, successStreak: 0, failStreak: 1, suggestion: null, updatedAt: '' } };
  const r = PROG.applyWorkout(plan, 'a', miss, 2400, prev);
  const st = r.next[LUNGE];
  ok('回退后的目标也是偶数', st.repsMin % 2 === 0 && st.repsMax % 2 === 0, `${st.repsMin}-${st.repsMax}`);
  ok('回退确实降下来了(18-22 → 16-20)', st.repsMin === 16 && st.repsMax === 20, `${st.repsMin}-${st.repsMax}`);
}

/* ================= 分享卡 ================= */
section('分享卡:说的是每侧几次');
{
  const log = logOf('2026-10-01', [{ exerciseId: ONE_ARM_ROW, nameZh: '单臂划船', sets: [set(24, 30), set(24, 30), set(24, 30)] }]);
  const card = SC.cardDataOf(log, H.personalRecords([log]));
  ok('卡上的条目带了单侧标记', card.entries[0].sided === true);
  ok('卡上写「3 组 · 30kg × 每侧 12」', SC.setSummary(card.entries[0]) === '3 组 · 30kg × 每侧 12', SC.setSummary(card.entries[0]));
  const biEntry = { nameZh: '卧推', sets: 3, topWeightKg: 30, topReps: 12 };
  ok('双侧条目一个字都没变', SC.setSummary(biEntry) === '3 组 · 30kg × 12', SC.setSummary(biEntry));
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
