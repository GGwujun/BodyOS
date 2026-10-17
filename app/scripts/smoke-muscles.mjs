/**
 * M3.1 肌群周容量 + M3.2 恢复模型 + M3.3 平衡诊断 冒烟测试
 * 用法:node scripts/smoke-muscles.mjs(.smoke 目录由 tsc 预先生成)
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

const M = require('../.smoke/pkg-exercise/engine/muscles.js');
const R = require('../.smoke/pkg-exercise/engine/recovery.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

/* ================= 肌群归类 ================= */
const bench = M.groupsOf('0025');   // 杠铃卧推:胸 + 三头 + 肩
ok('卧推 → 胸(主动) + 手臂/肩(协同)',
  bench.length === 3 && bench[0].group === 'chest' && bench[0].w === 1
  && bench.some((x) => x.group === 'arm' && x.w === 0.5)
  && bench.some((x) => x.group === 'shoulder' && x.w === 0.5),
  JSON.stringify(bench));
ok('不存在的动作 → 空', M.groupsOf('nope').length === 0);

const day = (date, entries, extra = {}) => ({
  id: `wo-${date}`, planId: 'p', dayKey: 'd', dayTitle: '练', date,
  durationSec: 1800, totalSets: 0, totalReps: 0, totalVolumeKg: 0, avgRir: null,
  entries, ...extra
});

// 一次推日:卧推 4 组 + 引体/划船去 hpull 用一个拉的动作
const pushDay = day('2026-10-12', [
  { exerciseId: '0025', nameZh: '杠铃卧推', sets: [{ reps: 8, weightKg: 60, rir: 2 }, { reps: 8, weightKg: 60, rir: 2 }, { reps: 8, weightKg: 60, rir: 1 }, { reps: 8, weightKg: 60, rir: 1 }] }
]);
const w = M.loadsOf([pushDay]);
const chest = w.find((s) => s.group === 'chest');
const armW = w.find((s) => s.group === 'arm');
ok('容量:卧推 4 组 → 胸 4 计权组', chest.sets === 4 && chest.rawSets === 4, JSON.stringify(chest));
ok('容量:协同肌记半组 → 手臂 2', armW.sets === 2 && armW.rawSets === 4, JSON.stringify(armW));
ok('容量:算出容量 kg', chest.volumeKg === 4 * 8 * 60, String(chest.volumeKg));
ok('容量:没练到的肌群为 0', w.find((s) => s.group === 'calf').sets === 0);
ok('容量:只列练到的', M.trained(w).every((s) => s.rawSets > 0) && M.trained(w).length === 3,
  M.trained(w).map((s) => `${s.group}:${s.sets}`).join(' '));
ok('容量:统计口覆盖七个大组', M.GROUP_ORDER.length === 7 && w.length === 7);

ok('判定:胸 4 组 → 偏少/几乎没练', ['偏少', '几乎没练'].includes(M.volumeVerdict('chest', 4).label), M.volumeVerdict('chest', 4).label);
ok('判定:胸 14 组 → 合适', M.volumeVerdict('chest', 14).label === '合适');
ok('判定:胸 30 组 → 偏多', M.volumeVerdict('chest', 30).label === '偏多');

const recent = M.recentLoads([pushDay, day('2026-01-01', [])], 7, 'all', new Date('2026-10-13T12:00:00'));
ok('近 7 天只算窗口内的', recent.find((s) => s.group === 'chest').sets === 4, String(recent.find((s) => s.group === 'chest').sets));

/* ================= 恢复模型 ================= */
ok('强度锚定:力竭(RIR 0)最占恢复', R.setIntensity(0) === 1.45, String(R.setIntensity(0)));
ok('强度锚定:RIR 越大越轻', R.setIntensity(5) < R.setIntensity(2), `${R.setIntensity(5)} < ${R.setIntensity(2)}`);
ok('强度锚定:没评分为中性 1.0', R.setIntensity(null) === 1 && R.setIntensity(undefined) === 1);

const NOW = new Date('2026-10-12T12:00:00');
const recNow = R.recoveryOf([pushDay], NOW).find((r) => r.group === 'chest');
ok('刚练完:胸没恢复', recNow.recovered < 80 && R.recoveryTone(recNow.recovered) !== 'fresh',
  `${recNow.recovered}% / 疲劳 ${recNow.fatigue}`);
ok('刚练完:给出还需几小时', recNow.etaHours > 0, `${recNow.etaHours}h`);
ok('刚练完:记录上次训练日', recNow.lastDate === '2026-10-12');

const rec3d = R.recoveryOf([pushDay], new Date('2026-10-15T12:00:00')).find((r) => r.group === 'chest');
ok('三天后:疲劳衰减、恢复度上升', rec3d.recovered > recNow.recovered, `${recNow.recovered}% → ${rec3d.recovered}%`);
const rec7d = R.recoveryOf([pushDay], new Date('2026-10-19T12:00:00')).find((r) => r.group === 'chest');
ok('七天:完全视为已恢复', rec7d.recovered >= 85 && rec7d.etaHours === 0, `${rec7d.recovered}% / eta ${rec7d.etaHours}`);
ok('半衰期:大肌群 > 小肌群', R.HALF_LIFE_H.leg > R.HALF_LIFE_H.arm, `${R.HALF_LIFE_H.leg}h vs ${R.HALF_LIFE_H.arm}h`);

// 同样的组数,留余力 vs 练到力竭 —— 力竭更占恢复
const easy = day('2026-10-12', [{ exerciseId: '0025', nameZh: '卧推', sets: Array.from({ length: 4 }, () => ({ reps: 8, weightKg: 60, rir: 5 })) }]);
const hard = day('2026-10-12', [{ exerciseId: '0025', nameZh: '卧推', sets: Array.from({ length: 4 }, () => ({ reps: 8, weightKg: 60, rir: 0 })) }]);
const rEasy = R.recoveryOf([easy], NOW).find((r) => r.group === 'chest');
const rHard = R.recoveryOf([hard], NOW).find((r) => r.group === 'chest');
ok('练到力竭比留余力更占恢复', rHard.recovered < rEasy.recovered, `力竭 ${rHard.recovered}% < 留余力 ${rEasy.recovered}%`);

ok('没练过的肌群不进恢复列表', R.relevant(R.recoveryOf([pushDay], NOW)).every((r) => r.lastDate));
ok('恢复列表按最该歇的排最前', (() => {
  const l = R.recoveryOf([pushDay], NOW);
  return l.every((r, i) => i === 0 || l[i - 1].recovered <= r.recovered);
})());
ok('恢复度不越界', R.recoveryOf([pushDay], NOW).every((r) => r.recovered >= 0 && r.recovered <= 100));
ok('结论文案给出最该歇的部位', /胸/.test(R.recoveryVerdict(R.recoveryOf([pushDay], NOW))),
  R.recoveryVerdict(R.recoveryOf([pushDay], NOW)));
ok('没有记录时给出引导', /还没有训练记录/.test(R.recoveryVerdict(R.recoveryOf([], NOW))));

/* ================= 推拉 / 上下肢平衡 ================= */
const pullDay = day('2026-10-13', [
  { exerciseId: '0293', nameZh: '杠铃划船', sets: Array.from({ length: 4 }, () => ({ reps: 10, weightKg: 40, rir: 2 })) }
]);
const legDay = day('2026-10-14', [
  { exerciseId: '0043', nameZh: '杠铃深蹲', sets: Array.from({ length: 4 }, () => ({ reps: 8, weightKg: 60, rir: 2 })) }
]);
const onlyPush = M.balanceOf([pushDay]);
ok('样本太少不下结论', onlyPush.pushPullSkew === null, String(onlyPush.pushPullSkew));
ok('推组数统计', onlyPush.pushSets === 4 && onlyPush.pullSets === 0, `${onlyPush.pushSets}:${onlyPush.pullSets}`);

const both = M.balanceOf([pushDay, pushDay, pullDay]);
ok('推拉都有时给出偏向', both.pushPullSkew !== null, String(both.pushPullSkew));
ok('推多 → 提示补背', both.pushPullSkew > 0 && /划船|面拉|背/.test(both.tips.join(' ')), both.tips.join(' | '));

const mixed = M.balanceOf([pushDay, pullDay, legDay]);
ok('上肢/下肢分别统计', mixed.upperSets === 8 && mixed.lowerSets === 4, `${mixed.upperSets}:${mixed.lowerSets}`);
ok('差距不够大时不提醒上下肢', mixed.upperLowerSkew === 33 && !/腿/.test(mixed.tips.join(' ')), `skew=${mixed.upperLowerSkew}`);
const upperHeavy = M.balanceOf([pushDay, pushDay, pullDay, legDay]);
ok('上肢偏多 → 提示别跳过练腿', upperHeavy.upperLowerSkew >= 40 && /腿/.test(upperHeavy.tips.join(' ')),
  `skew=${upperHeavy.upperLowerSkew} | ${upperHeavy.tips.join(' | ')}`);
ok('均衡时不给多余提醒', M.balanceOf([pushDay, pullDay, legDay, legDay, legDay]).tips.length <= 1,
  M.balanceOf([pushDay, pullDay, legDay, legDay, legDay]).tips.join(' | '));

ok('动作库里查不到的动作不参与平衡', M.pushPullOf('nope') === null && M.upperLowerOf('nope') === null);

/* ================= 组数口径:全部组 / 只看有效组 =================
   一组算不算数由 effort.ts 的 HARD_RIR 说了算(≤ 3),能不能切由 canFilterHard 说了算。
   这一节盯三件事:换了口径数得对不对、默认口径没被改掉、门槛的边界在哪。
   四个组刻意设计成:一个真有效(2)、一个刚好在线(3)、一个留太多余量(4)、一个没评(null)——
   混在一起才能同时看出「按 RIR 排」和「没评的不算」两件事。 */
const E = require('../.smoke/pkg-exercise/engine/effort.js');
const mixedDay = day('2026-10-12', [
  { exerciseId: '0025', nameZh: '杠铃卧推', sets: [
    { reps: 8, weightKg: 60, rir: 2 },
    { reps: 8, weightKg: 60, rir: 3 },
    { reps: 8, weightKg: 60, rir: 4 },
    { reps: 8, weightKg: 60, rir: null }
  ] }
]);
const mAll = M.loadsOf([mixedDay]);
const mHard = M.loadsOf([mixedDay], 'hard');
ok('口径:不传就是全部组(默认没被改掉)',
  mAll.find((s) => s.group === 'chest').sets === 4, String(mAll.find((s) => s.group === 'chest').sets));
ok('口径:有效组只数 RIR ≤ 3(4 和没评的都出局)',
  mHard.find((s) => s.group === 'chest').sets === 2 && mHard.find((s) => s.group === 'chest').rawSets === 2,
  JSON.stringify(mHard.find((s) => s.group === 'chest')));
ok('口径:协同肌的半组权重不因换口径而变',
  mHard.find((s) => s.group === 'arm').sets === 1 && mAll.find((s) => s.group === 'arm').sets === 2,
  `有效 ${mHard.find((s) => s.group === 'arm').sets} / 全部 ${mAll.find((s) => s.group === 'arm').sets}`);
ok('口径:容量跟着一起缩(不能只换组数留下旧的容量)',
  mHard.find((s) => s.group === 'chest').volumeKg === 2 * 8 * 60 && mAll.find((s) => s.group === 'chest').volumeKg === 4 * 8 * 60,
  `有效 ${mHard.find((s) => s.group === 'chest').volumeKg} / 全部 ${mAll.find((s) => s.group === 'chest').volumeKg}`);
ok('口径:全部留余量时有效组为 0(不是「没数据」)',
  M.loadsOf([day('2026-10-12', [{ exerciseId: '0025', nameZh: '卧推', sets: [{ reps: 8, weightKg: 60, rir: 4 }, { reps: 8, weightKg: 60, rir: 4 }] }])], 'hard')
    .find((s) => s.group === 'chest').sets === 0);

const recH = M.recentLoads([mixedDay, day('2026-01-01', [])], 7, 'hard', new Date('2026-10-13T12:00:00'));
const recA = M.recentLoads([mixedDay, day('2026-01-01', [])], 7, 'all', new Date('2026-10-13T12:00:00'));
ok('口径:窗口外的那天两种口径都不算', recH.find((s) => s.group === 'chest').sets === 2 && recA.find((s) => s.group === 'chest').sets === 4,
  `有效 ${recH.find((s) => s.group === 'chest').sets} / 全部 ${recA.find((s) => s.group === 'chest').sets}`);

const balH = M.balanceOf([mixedDay], 'hard');
const balA = M.balanceOf([mixedDay], 'all');
ok('口径:推拉比也跟着换口径', balA.pushSets === 4 && balH.pushSets === 2, `${balA.pushSets} → ${balH.pushSets}`);
ok('口径:样本判定用的也是换过口径的组数(4 组还不够 6 组)',
  balA.pushPullSkew === null && balH.pushPullSkew === null, `${balA.pushPullSkew} / ${balH.pushPullSkew}`);

/* 门槛:评过 5 组以上、且评过的占一半以上 —— 两条都要过 */
ok('门槛:刚好 5 组(一半)可以切', E.canFilterHard({ sets: 10, rated: 5 }) === true);
ok('门槛:评过 4 组不给切(少于 5 组说不上习惯)', E.canFilterHard({ sets: 10, rated: 4 }) === false);
ok('门槛:评过不到一半不给切(切过去是凭空少一截的数)',
  E.canFilterHard({ sets: 12, rated: 5 }) === false && E.canFilterHard({ sets: 12, rated: 6 }) === true);
ok('门槛:没做过训练不给切', E.canFilterHard({ sets: 0, rated: 0 }) === false);
ok('门槛:线上那组算有效(RIR 3 是)', E.isHardSet(3) === true && E.isHardSet(4) === false && E.isHardSet(null) === false);

/* ================= 计划 vs 实际:两个数得比得起来 =================
   这张卡把「计划一轮的组数」和「近 7 天练的组数」摆在同一根条上,所以两边的**计权口径
   必须一模一样** —— 差一点,比出来的就不是达成率,而是两套算法之差。
   所以核心那一条断言是:照处方练完一轮,实际组数要**逐组等于**计划组数。 */
const C = require('../.smoke/pkg-exercise/engine/cycle.js');

/** 只填引擎真的读的那几个字段(组数/动作),其余按 PlannedExercise 的形状补齐 */
const pItem = (exerciseId, sets) => ({
  exerciseId, nameZh: exerciseId, patternId: 'hpush', sets, repsMin: 8, repsMax: 10,
  restSec: 90, progression: 'linear', weightKg: 60, weightStepKg: 2.5, alternates: []
});
const pDay = (key, items) => ({ key, title: key, focus: '', estMin: 45, items });

// 卧推 4 组(胸1 + 臂.5 + 肩.5)/ 划船 3 组(背1 + 臂.5)/ 深蹲 5 组(腿1 + 小腿.5 + 核心.5)/ 提踵 3 组(小腿1 + 腿.5)
const planDays = [
  pDay('push', [pItem('0025', 4), pItem('0027', 3)]),
  pDay('legs', [pItem('0043', 5), pItem('1372', 3)])
];
const pv = M.planLoads(planDays);
const setsIn = (arr, g) => arr.find((s) => s.group === g).sets;

ok('计划量:主动肌 1 组(卧推 4 组 → 胸 4)', setsIn(pv, 'chest') === 4, String(setsIn(pv, 'chest')));
ok('计划量:协同肌半组(划船 3 组 → 背 3 / 臂累计 2 + 1.5 = 3.5)',
  setsIn(pv, 'back') === 3 && setsIn(pv, 'arm') === 3.5, JSON.stringify(pv.map((s) => `${s.group}:${s.sets}`)));
ok('计划量:同一动作里同一大组只记一次(深蹲的臀/股四/腘绳都归腿)',
  setsIn(pv, 'leg') === 6.5, String(setsIn(pv, 'leg')));
ok('计划量:跨动作累加(深蹲 → 小腿 0.5 + 提踵 → 小腿 1 = 5.5)', setsIn(pv, 'calf') === 5.5, String(setsIn(pv, 'calf')));
ok('计划量:没排到的部位是 0(不是「没数据」)',
  M.planLoads([pDay('x', [pItem('1372', 3)])]).find((s) => s.group === 'chest').sets === 0);
ok('计划量:容量恒为 0(计划的重量是建议值、次数是区间,乘出来的是估的)',
  pv.every((s) => s.volumeKg === 0));
ok('计划量:库里没有的动作不参与(自定义动作/已删动作)', M.planLoads([pDay('x', [pItem('nope', 5)])]).every((s) => s.sets === 0));
ok('计划量:七个大组一个不少', pv.length === 7);

/** 按处方原样做一遍:每个动作做满它规定的组数 */
const asLogs = (days) => days.map((d, i) => day(`2026-10-1${i}`, d.items.map((it) => ({
  exerciseId: it.exerciseId, nameZh: it.nameZh,
  sets: Array.from({ length: it.sets }, () => ({ reps: 8, weightKg: 60, rir: 2 }))
}))));
const doneAll = M.loadsOf(asLogs(planDays));
ok('不变式:照处方练完一轮 → 实际逐组等于计划',
  M.GROUP_ORDER.every((g) => setsIn(doneAll, g) === setsIn(pv, g)),
  M.GROUP_ORDER.filter((g) => setsIn(doneAll, g) !== setsIn(pv, g)).map((g) => `${g} ${setsIn(doneAll, g)}/${setsIn(pv, g)}`).join(' '));

/* 减载周:计划那一栏必须走 applyCycle —— 否则用户按降过档的处方做完,卡上却说他差一截 */
const deloaded = C.applyCycle({ ...pDay('p', []), cycle: { style: 'line', week: 4 }, days: planDays }, {}).days;
const dv = M.planLoads(deloaded);
ok('减载周:计划量跟着降(卧推 4 → 3、划船 3 → 2)',
  setsIn(dv, 'chest') === 3 && setsIn(dv, 'back') === 2 && setsIn(dv, 'chest') < setsIn(pv, 'chest'),
  JSON.stringify(dv.map((s) => `${s.group}:${s.sets}`)));
const doneDeload = M.loadsOf(asLogs(deloaded));
ok('不变式:减载周也成立(实际按同一份派生计划算)',
  M.GROUP_ORDER.every((g) => setsIn(doneDeload, g) === setsIn(dv, g)));
ok('减载周:各动作少做一组(深蹲 5→4、提踵 3→2,协同肌跟着半档)',
  setsIn(dv, 'leg') === 4 + 1 && setsIn(dv, 'calf') === 2 + 2, JSON.stringify(dv.map((s) => `${s.group}:${s.sets}`)));
const thin = { ...pDay('p', []), cycle: { style: 'line', week: 4 }, days: [pDay('x', [pItem('0025', 2)])] };
ok('减载周:本来只有 2 组的不再降(减载不是把动作砍没)',
  setsIn(M.planLoads(C.applyCycle(thin, {}).days), 'chest') === 2);

/* 达成档 */
ok('达成档:做满算够(超了也算够,多做的部分是上面那张卡的事)',
  M.planVerdict(16, 16).label === '练够了' && M.planVerdict(20, 16).label === '练够了');
ok('达成档:七成以上但没做满 → 差一点', M.planVerdict(12, 16).label === '差一点');
ok('达成档:不到七成 → 差得多(含一组都没做)', M.planVerdict(11, 16).label === '差得多' && M.planVerdict(0, 16).label === '差得多');
ok('达成档:边界正好 0.7 算差一点', M.planVerdict(7, 10).label === '差一点');
ok('达成档:计划里没有 → 单独一档,不是「超额完成」',
  M.planVerdict(10, 0).label === '计划里没有' && M.planVerdict(10, 0).tone === 'warning');
ok('达成档:两边都是 0 → 无档(这种行页面也不画)', M.planVerdict(0, 0).tone === 'none');

/* ================= 肌群 → 动作(肌群页那条「练得到背的动作 ›」) =================
   反查的判据必须和统计**同源**:统计里给 0.5 组的动作,在这份清单里就得出现 ——
   不然「背练得偏少」点进去,列出来的清单和刚看的那个数对不上。 */
ok('反查:卧推练得到胸(主动肌)', M.hitsGroup('0025', 'chest') === true);
ok('反查:卧推也练得到肩与臂(协同肌 —— 统计里算 0.5 组的那些)', M.hitsGroup('0025', 'shoulder') === true && M.hitsGroup('0025', 'arm') === true);
ok('反查:卧推练不到小腿', M.hitsGroup('0025', 'calf') === false);
ok('反查:划船练得到背,也练得到臂(二头写在次要肌里)', M.hitsGroup('0027', 'back') === true && M.hitsGroup('0027', 'arm') === true);
ok('反查:深蹲练得到臀腿、小腿与核心(股四/腘绳/臀都归臀腿,核心是次要肌)', M.hitsGroup('0043', 'leg') === true && M.hitsGroup('0043', 'calf') === true && M.hitsGroup('0043', 'core') === true);
ok('反查:提踵练得到小腿,也练得到臀腿(腘绳与臀写在次要肌里)', M.hitsGroup('1372', 'calf') === true && M.hitsGroup('1372', 'leg') === true);
ok('反查:库里没有的动作一个肌群都不算', M.GROUP_ORDER.every((g) => M.hitsGroup('nope', g) === false));
ok('反查与统计同源:统计里算 0.5 组的肌群,反查里必须出现(半组也算练到了)',
  setsIn(M.loadsOf([day('2026-10-12', [{ exerciseId: '0025', nameZh: '卧推', sets: [{ reps: 8, weightKg: 60, rir: 2 }] }])]), 'arm') === 0.5
  && M.hitsGroup('0025', 'arm') === true);

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
