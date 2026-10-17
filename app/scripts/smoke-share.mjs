/**
 * M7.3 训练分享卡 冒烟测试 —— 排版计算 + 用假 ctx 跑一遍绘制,看画出来的字对不对。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-share.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: {}, getStorageSync: () => '' };
  return origLoad.call(this, req, ...rest);
};

const S = require('../.smoke/pkg-exercise/engine/share-card.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/* 假 ctx:记下每一次绘制,顺便模拟 measureText */
function fakeCtx(charWidth = 13) {
  const calls = [];
  let fillStyle = '';
  return {
    calls,
    get fillStyle() { return fillStyle; },
    set fillStyle(v) { fillStyle = v; },
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (x, y) => calls.push(['moveTo', x, y]),
    lineTo: (x, y) => calls.push(['lineTo', x, y]),
    arc: (x, y, r) => calls.push(['arc', x, y, r]),
    closePath: () => calls.push(['closePath']),
    fill: () => calls.push(['fill']),
    fillRect: (x, y, w, h) => calls.push(['fillRect', x, y, w, h]),
    fillText: (t, x, y) => calls.push(['fillText', t, x, y, fillStyle]),
    measureText: (t) => ({ width: String(t).length * charWidth }),
    createLinearGradient: () => ({ addColorStop: () => undefined })
  };
}
const textsOf = (ctx) => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);

const log = (over = {}) => ({
  id: 'wo-1', planId: 'p1', dayKey: 'a', dayTitle: '推 · 胸肩三头', date: '2026-10-15',
  durationSec: 3720, totalSets: 14, totalReps: 132, totalVolumeKg: 12840, avgRir: 2,
  entries: [
    { exerciseId: '0025', nameZh: '杠铃卧推', sets: [{ reps: 8, weightKg: 60, rir: 2 }, { reps: 6, weightKg: 70, rir: 1 }] },
    { exerciseId: '0652', nameZh: '引体向上', sets: [{ reps: 10, weightKg: null, rir: 2 }, { reps: 8, weightKg: null, rir: 1 }] },
    { exerciseId: '9999', nameZh: '跳过没做的动作', sets: [{ reps: 0, weightKg: 40, rir: null }] }
  ],
  ...over
});

section('时长/日期/数字怎么说');
// 时长的念法已收进唯一的时长口径 utils/duration.ts(fmtSpan 的细项断言在 smoke-duration.mjs)。
// 这里只把住一件事:**分享卡没有自己再算一遍** —— 画出来的「用时」必须等于那个口径的输出。
const DUR = require('../.smoke/utils/duration.js');
ok('分享卡的用时就是统一口径的输出', (() => {
  for (const sec of [540, 1500, 3720, 7200]) {
    const c = fakeCtx();
    S.drawCard(c, S.cardDataOf(log({ durationSec: sec }), []));
    if (!textsOf(c).includes(DUR.fmtSpan(sec))) return false;
  }
  return true;
})());
ok('日期带星期', S.dateText('2026-10-15') === '10月15日 · 周四', S.dateText('2026-10-15'));
ok('日期解析不了就原样显示', S.dateText('随便写的') === '随便写的');
ok('容量上千分位', S.withComma(12840) === '12,840');
ok('不到 10 吨就用 kg(健身房里说 kg 更顺口)', S.volumeText(8640) === '8,640 kg');
ok('上万吨换成吨', S.volumeText(12840) === '12.8 吨' && S.volumeText(23400) === '23.4 吨');
ok('没有容量不写成 NaN', S.volumeText(0) === '0 kg');

section('一组动作怎么写');
ok('有配重:最重那组', S.setSummary({ nameZh: 'x', sets: 2, topWeightKg: 70, topReps: 6 }) === '2 组 · 70kg × 6');
ok('自重动作写自重', S.setSummary({ nameZh: 'x', sets: 2, topWeightKg: null, topReps: 10 }) === '2 组 · 自重 × 10');
ok('小数重量不进两位', S.setSummary({ nameZh: 'x', sets: 1, topWeightKg: 62.5, topReps: 8 }) === '1 组 · 62.5kg × 8');

section('卡上列哪几个动作');
const many = Array.from({ length: 9 }, (_, i) => ({
  nameZh: `动作${i}`, sets: 3, topWeightKg: i === 7 ? 200 : 20, topReps: 8
}));
ok('最多 6 个', S.topEntries(many).length === 6);
ok('组数一样时重的排前面', S.topEntries(many)[0].nameZh === '动作7');
ok('组数多的动作排前面', (() => {
  const rows = S.topEntries([
    { nameZh: '只练了一组的小重量', sets: 1, topWeightKg: 100, topReps: 5 },
    { nameZh: '练了四组的', sets: 4, topWeightKg: 20, topReps: 10 }
  ]);
  return rows[0].nameZh === '练了四组的';
})());
ok('徒手动作不会被杠铃动作全挤掉', (() => {
  const rows = S.topEntries([
    { nameZh: '引体向上', sets: 4, topWeightKg: null, topReps: 12 },
    ...Array.from({ length: 3 }, (_, i) => ({ nameZh: `器械${i}`, sets: 1, topWeightKg: 10, topReps: 5 }))
  ]);
  return rows[0].nameZh === '引体向上';
})());
ok('没有动作也不炸', S.topEntries([]).length === 0);

section('从训练日志生成卡数据');
const data = S.cardDataOf(log());
ok('日期/训练日名带过来', data.date === '2026-10-15' && data.dayTitle === '推 · 胸肩三头');
ok('只统计真做了的组(跳过的 0 次不算)', data.entries.length === 2, `entries=${data.entries.length}`);
ok('重量取最重那组(70kg × 6,不是最后一组)', data.entries[0].topWeightKg === 70 && data.entries[0].topReps === 6);
ok('总容量用日志里的数(不重新算)', data.totalVolumeKg === 12840);
ok('没传纪录时没有纪录文案', data.prText === null);

section('个人纪录文案');
const prs = [
  { exerciseId: '0025', nameZh: '杠铃卧推', topKg: 70, topReps: 6, date: '2026-10-15' },
  { exerciseId: '0652', nameZh: '引体向上', topKg: 0, topReps: 10, date: '2026-10-15' },
  { exerciseId: '9999', nameZh: '别的动作', topKg: 100, topReps: 5, date: '2026-10-15' },
  { exerciseId: '0025', nameZh: '杠铃卧推', topKg: 999, topReps: 1, date: '2026-01-01' }
];
ok('只认这次练到的动作 + 今天这个日期', S.prTextOf(log(), prs)?.includes('杠铃卧推 70kg × 6'));
ok('没配重的动作(引体)不进纪录文案', !S.prTextOf(log(), prs)?.includes('引体'));
ok('别天的纪录不算今天刷的', !S.prTextOf(log(), prs)?.includes('999'));
ok('补录的训练不宣称刷新纪录', S.prTextOf(log({ manual: true }), prs) === null);
ok('没有纪录就是 null', S.prTextOf(log(), []) === null);
ok('三个以上纪录只说个数', (() => {
  const three = [
    { exerciseId: '0025', nameZh: '杠铃卧推', topKg: 70, topReps: 6, date: '2026-10-15' },
    { exerciseId: '0652', nameZh: '引体向上', topKg: 20, topReps: 6, date: '2026-10-15' },
    { exerciseId: '9999', nameZh: '坐姿划船', topKg: 50, topReps: 8, date: '2026-10-15' }
  ];
  const t = S.prTextOf(log({
    entries: [...log().entries, { exerciseId: '9999', nameZh: '坐姿划船', sets: [{ reps: 8, weightKg: 50, rir: 2 }] }]
  }), three);
  return t?.includes('3 个动作') ?? false;
})());

section('画一遍:画的字对不对');
const ctx = fakeCtx();
S.drawCard(ctx, S.cardDataOf(log(), prs));
const texts = textsOf(ctx);
ok('画了底(白色铺满整张卡)', ctx.calls.some((c) => c[0] === 'fillRect' && c[3] === S.CARD_W && c[4] === S.CARD_H));
ok('画了绿带', ctx.calls.some((c) => c[0] === 'fillRect' && c[4] === 300));
ok('有「训练完成」', texts.includes('训练完成'));
ok('有大日期', texts.some((t) => t.includes('10月15日')));
ok('有训练日名', texts.includes('推 · 胸肩三头'));
ok('三个大数字:组数/容量/用时', texts.includes('14') && texts.includes('12.8 吨') && texts.includes('1 小时 2 分'));
ok('三个数字的文字标签', texts.includes('组') && texts.includes('总容量') && texts.includes('用时'));
ok('动作名上了卡', texts.includes('杠铃卧推') && texts.includes('引体向上'));
ok('每组数据上了卡', texts.includes('2 组 · 70kg × 6') && texts.includes('2 组 · 自重 × 10'));
ok('跳过的动作没上卡', !texts.some((t) => t.includes('跳过')));
ok('纪录文案上了卡', texts.some((t) => t.includes('新纪录')));
ok('有品牌页脚', texts.includes('BodyOS · 训练日志'));

section('画一遍:空训练/长名字');
const ctx2 = fakeCtx();
S.drawCard(ctx2, S.cardDataOf(log({ entries: [], totalSets: 0, totalVolumeKg: 0, durationSec: 0 })));
ok('没有动作明细时给一句实话', textsOf(ctx2).includes('这次没有记录到动作明细'));
ok('零容量不写成 NaN', !textsOf(ctx2).some((t) => /NaN|undefined/.test(t)));

const LONG_TITLE = '一个特别特别特别长的训练日名字用来测试截断逻辑是不是真的生效了';
const ctx3 = fakeCtx(20);   // 每个字 20px 很宽 → 512px 的可用宽度放不下
S.drawCard(ctx3, S.cardDataOf(log({ dayTitle: LONG_TITLE })));
ok('长训练日名会被截断加省略号', textsOf(ctx3).some((t) => t.endsWith('…')));
ok('截断后确实塞进了卡宽内(含省略号 ≤ 512px)', (() => {
  const long = textsOf(ctx3).find((t) => t.includes('特别'));
  return !!long && long !== LONG_TITLE && long.length * 20 <= 512;
})());

const ctx4 = fakeCtx();
S.drawCard(ctx4, { date: '2026-10-15', dayTitle: '', durationSec: 0, totalSets: 0, totalVolumeKg: 0, entries: [] });
ok('训练日名为空也不会画空字符串', !textsOf(ctx4).includes(''));

section('无 measureText 的环境也不能崩');
const ctx5 = fakeCtx();
ctx5.measureText = () => { throw new Error('no measureText'); };
S.drawCard(ctx5, S.cardDataOf(log()));
ok('拿不到文字宽度时照画不误', textsOf(ctx5).includes('训练完成'));
ok('fitText 在测量失败时原样返回', S.fitText(ctx5, '很长的名字', 10) === '很长的名字');

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
