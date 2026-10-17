/**
 * M10.10 复制成文字(⑪1)冒烟测试 —— 训练日志 → 一段能直接粘出去的纯文本。
 *
 * 分享卡是「发出去好看」的图,但很多场景要的是**能改的文本**:发给教练之后他要添两句、
 * 填进自己的表格、跟以前的记录存一起。图里的字选不中,教练只能照着敲一遍。
 *
 * 这套用例盯三件事:
 *   ①**只写练了的组**(次数 > 0)—— 跳过的组写进去就是谎报做了,而它在这段文字里
 *     没有任何记号能和真练的区分开;
 *   ②**每一组怎么念和别处一样** —— 重量走 loadText(自重 / 助力 30kg / +20kg),
 *     次数走 sideRepsLabel(每侧 N)。这里错起来不报错,只会让「分享卡上写每侧 10、
 *     复制出来的文字写 10」;
 *   ③**超级组是一块** —— 同组号且相邻算一块,标一行「超级组」;只有一半进了日志
 *     (另一个动作被删/跳过)时不标,标了反而像少写了一个。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-workout-text.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: {}, getStorageSync: () => '' };
  return origLoad.call(this, req, ...rest);
};

const E = '../.smoke/pkg-exercise/engine/';
const W = require(`${E}workout-text.js`);
const L = require(`${E}load.js`);
const S = require(`${E}sided.js`);
const SC = require(`${E}share-card.js`);
const DUR = require('../.smoke/utils/duration.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/* 用例里用到的真实动作(全部来自 1,324 条动作库) */
const BENCH = '0025';        // barbell bench press — 杠铃卧推(普通负重)
const PULLUP = '0652';       // pull up — 引体向上(自重)
const ASSISTED = '0017';     // assisted pull-up — 助力引体向上(助力器械)
const WEIGHTED_DIP = '3313'; // weighted straight bar dip — 负重双杠臂屈伸(附加重量)
const ONE_ARM = '0638';      // one arm chin-up — 单臂引体向上(单侧)
const ROW = '0293';          // dumbbell bent over row — 哑铃俯身划船(双侧)

/** 一份最小可用的日志(字段齐全,和 store 里落库的形状一致) */
const log = (over = {}) => ({
  id: 'wo-1', planId: 'p1', dayKey: 'a', dayTitle: '推 · 胸肩三头', date: '2026-10-15',
  durationSec: 3720, totalSets: 4, totalReps: 28, totalVolumeKg: 12840, avgRir: 2,
  entries: [
    { exerciseId: BENCH, nameZh: '杠铃卧推', sets: [{ reps: 8, weightKg: 60, rir: 2 }, { reps: 6, weightKg: 70, rir: 1 }] },
    { exerciseId: PULLUP, nameZh: '引体向上', sets: [{ reps: 10, weightKg: null, rir: 2 }] },
    { exerciseId: ROW, nameZh: '哑铃俯身划船', sets: [{ reps: 12, weightKg: 20, rir: 3 }] }
  ],
  ...over
});
const blocks = (t) => t.split('\n\n');
const lines = (t) => t.split('\n');

section('标题那一块:哪天、练的什么');
ok('日期走统一口径(和分享卡同一句)', blocks(W.workoutText(log()))[0].startsWith(SC.dateText('2026-10-15')), blocks(W.workoutText(log()))[0].split('\n')[0]);
ok('带上训练日名', lines(W.workoutText(log()))[0] === '10月15日 · 周四 · 推 · 胸肩三头', lines(W.workoutText(log()))[0]);
ok('没有训练日名也不留个空分隔符', lines(W.workoutText(log({ dayTitle: '' })))[0] === '10月15日 · 周四');
ok('补录的标一句「补录」(事后回忆填的,发给教练时这个区别有意义)', lines(W.workoutText(log({ manual: true })))[0].endsWith('· 补录'));
ok('当场记的不乱标', !W.workoutText(log({ manual: false })).includes('补录'));
ok('标题块就两行:一行哪天、一行事实', lines(blocks(W.workoutText(log()))[0]).length === 2);

section('事实那一行:时长 · 组 · 次 · 容量 · 强度');
ok('时长在最前(走唯一时长口径)', W.factsText(log()).startsWith(`${DUR.fmtSpan(3720)} · `), W.factsText(log()));
ok('组 · 次 · 容量按计划页历史那一行的顺序', W.factsText(log()) === `${DUR.fmtSpan(3720)} · 4 组 · 28 次 · 12.8 吨 · 强度 RIR 2`, W.factsText(log()));
ok('容量上千分位', W.factsText(log({ totalVolumeKg: 8640 })).includes('8,640 kg'));
ok('时长为 0 就不写时长(破折号粘到聊天里没有意义)', !W.factsText(log({ durationSec: 0 })).includes('—') && W.factsText(log({ durationSec: 0 })).startsWith('4 组'));
ok('没打分就不写强度(一行里一半有一半没有更粗)', !W.factsText(log({ avgRir: null })).includes('RIR'));
ok('RIR 0 也要写出来(0 是满分,不是「没打分」)', W.factsText(log({ avgRir: 0 })).includes('强度 RIR 0'));
ok('没练出容量也不写 NaN', W.factsText(log({ totalVolumeKg: 0, totalSets: 0, totalReps: 0 })).includes('0 kg'));

section('一组怎么念:和别处同一套原子');
ok('普通负重:重量 × 次数', W.setText(BENCH, { reps: 8, weightKg: 60 }) === '60kg × 8', W.setText(BENCH, { reps: 8, weightKg: 60 }));
ok('自重动作写自重', W.setText(PULLUP, { reps: 10, weightKg: null }) === '自重 × 10', W.setText(PULLUP, { reps: 10, weightKg: null }));
ok('助力动作带「助力」两字(数字大了是更轻松)', W.setText(ASSISTED, { reps: 10, weightKg: 30 }) === '助力 30kg × 10', W.setText(ASSISTED, { reps: 10, weightKg: 30 }));
ok('附加重量带「+」(20kg 不是总负荷)', W.setText(WEIGHTED_DIP, { reps: 8, weightKg: 20 }) === '+20kg × 8', W.setText(WEIGHTED_DIP, { reps: 8, weightKg: 20 }));
ok('单侧动作说每侧几次(存的是两侧合计)', W.setText(ONE_ARM, { reps: 12, weightKg: null }) === '自重 × 每侧 6', W.setText(ONE_ARM, { reps: 12, weightKg: null }));
ok('小数重量不进两位', W.setText(BENCH, { reps: 8, weightKg: 62.5 }) === '62.5kg × 8');
ok('跨层:每一组的念法 = loadText + sideRepsLabel(不另拼一套)', (() => {
  for (const [id, w] of [[BENCH, 60], [WEIGHTED_DIP, 20], [ASSISTED, 35], [PULLUP, null], [ROW, 20], [ONE_ARM, 0]]) {
    for (const reps of [1, 8, 12, 13]) {
      const mine = W.setText(id, { reps, weightKg: w });
      const atoms = `${L.loadText(id, w)} × ${S.sideRepsLabel(id, reps)}`;
      if (mine !== atoms) return false;
    }
  }
  return true;
})());

section('只写练了的组');
ok('次数为 0 的组不写(写进去就是谎报做了)', !W.workoutText(log({
  entries: [{ exerciseId: BENCH, nameZh: '杠铃卧推', sets: [{ reps: 8, weightKg: 60 }, { reps: 0, weightKg: 40 }] }]
})).includes('40kg'));
ok('整个动作一组没做就不出现', !W.workoutText(log({
  entries: [
    { exerciseId: BENCH, nameZh: '杠铃卧推', sets: [{ reps: 8, weightKg: 60 }] },
    { exerciseId: PULLUP, nameZh: '跳过没做的动作', sets: [{ reps: 0, weightKg: null }] }
  ]
})).includes('跳过'));
ok('只剩标题一块时也不留空块', blocks(W.workoutText(log({ entries: [{ exerciseId: BENCH, nameZh: 'x', sets: [{ reps: 0, weightKg: null }] }] }))).length === 1);
ok('真练的组照写', W.workoutText(log()).includes('60kg × 8, 70kg × 6'));

section('超级组是一整块');
const SS = [
  { exerciseId: BENCH, nameZh: '杠铃卧推', superset: 's1', sets: [{ reps: 8, weightKg: 60 }] },
  { exerciseId: ROW, nameZh: '哑铃俯身划船', superset: 's1', sets: [{ reps: 12, weightKg: 20 }] },
  { exerciseId: PULLUP, nameZh: '引体向上', sets: [{ reps: 10, weightKg: null }] }
];
const ssText = W.workoutText(log({ entries: SS }));
const ssBlocks = blocks(ssText);
ok('两个动作合成一块(只标一次「超级组」)', ssBlocks.filter((b) => b.startsWith('超级组')).length === 1);
// 一个动作占两行(名字一行、组一行),照 openGym:组数多的时候不会把名字挤到一行末尾去
ok('块的结构:超级组 / 名字 / 组 / 名字 / 组', ssBlocks[1].split('\n').join('|') === '超级组|杠铃卧推|60kg × 8|哑铃俯身划船|20kg × 12', ssBlocks[1]);
ok('超级组里的两个动作挨着', ssBlocks[1].includes('杠铃卧推') && ssBlocks[1].includes('哑铃俯身划船'));
ok('不成组的动作另起一块,不标超级组', ssBlocks[2] === '引体向上\n自重 × 10', ssBlocks[2]);
ok('一个动作也是名字一行、组一行', ssBlocks[2].split('\n').length === 2);
ok('只有一半进了日志就不标(另一个动作被删了,标了像少写一个)', (() => {
  const t = W.workoutText(log({ entries: [{ ...SS[0] }] }));
  return !t.includes('超级组') && t.includes('杠铃卧推');
})());
ok('三成员超级组也只标一次', W.workoutText(log({
  entries: [SS[0], SS[1], { exerciseId: PULLUP, nameZh: '引体向上', superset: 's1', sets: [{ reps: 10, weightKg: null }] }]
})).split('超级组').length === 2);

section('一组的中间那个动作被跳过:块还在,少一行');
ok('同组里没做的动作不占行,剩下的照常归一块', (() => {
  const b = blocks(W.workoutText(log({
    entries: [SS[0], { ...SS[1], sets: [{ reps: 0, weightKg: 20 }] }]
  })));
  return b[1].startsWith('超级组') && b[1].includes('杠铃卧推') && !b[1].includes('划船');
})());

section('感受写在最后');
ok('有感受就单独一块,带「感受:」', blocks(W.workoutText(log({ note: '状态一般,卧推降了 2.5kg' }))).pop() === '感受:状态一般,卧推降了 2.5kg');
ok('没感受就没有这一块', !W.workoutText(log()).includes('感受'));
ok('空字符串的感受当没有', !W.workoutText(log({ note: '' })).includes('感受'));

section('整段读起来是连贯的');
ok('块与块之间空一行', W.workoutText(log()).split('\n\n').length === blocks(W.workoutText(log())).length);
ok('每个动作一块,顺序跟着日志走', (() => {
  const b = blocks(W.workoutText(log()));
  return b[1].startsWith('杠铃卧推') && b[2].startsWith('引体向上') && b[3].startsWith('哑铃俯身划船');
})());
ok('没有多余的空行(不会出现连着两个 \\n\\n)', !W.workoutText(log({ note: 'x' })).includes('\n\n\n'));
ok('没有空串/undefined/NaN', !/(undefined|NaN|\[object)/.test(W.workoutText(log())));

section('边界与脏输入');
ok('空日志只剩标题一块', blocks(W.workoutText(log({ entries: [], totalSets: 0, totalReps: 0, totalVolumeKg: 0, durationSec: 0, avgRir: null }))).length === 1);
ok('entries 字段缺失也不炸', typeof W.workoutText({ date: '2026-10-15', durationSec: 0, totalSets: 0, totalReps: 0, totalVolumeKg: 0 }) === 'string');
ok('日期解析不了就原样写出来', W.workoutText(log({ date: '随便写的' })).startsWith('随便写的'));
ok('组数为 0 的 sets 数组不产生空行', blocks(W.workoutText(log({ entries: [{ exerciseId: BENCH, nameZh: '杠铃卧推', sets: [] }] }))).length === 1);

section('单侧口径以计划为准(sidedOf)');
ok('计划里关掉了单侧开关 → 按双侧念', W.workoutText(log({
  entries: [{ exerciseId: ONE_ARM, nameZh: '单臂引体向上', sets: [{ reps: 12, weightKg: null }] }]
}), { sidedOf: () => false }).includes('自重 × 12'));
ok('计划里标了单侧 → 名字规则之外的也折半', W.workoutText(log({
  entries: [{ exerciseId: ROW, nameZh: '哑铃俯身划船', sets: [{ reps: 12, weightKg: 20 }] }]
}), { sidedOf: () => true }).includes('20kg × 每侧 6'));
ok('不传 sidedOf 时退回动作库名字规则', W.workoutText(log({
  entries: [{ exerciseId: ONE_ARM, nameZh: '单臂引体向上', sets: [{ reps: 12, weightKg: null }] }]
})).includes('自重 × 每侧 6'));

section('这段文字是可以直接发出去的');
const out = W.workoutText(log({ note: '感觉不错' }));
ok('不出现任何图片链接/本地路径', !/https?:|\/tmp\/|\.png|\.jpg/.test(out));
ok('不出现该藏起来的东西(用户不会想把它发给教练)', !/AI|智能|大模型|智谱/.test(out));

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
