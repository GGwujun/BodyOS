/**
 * 教练冒烟测试 —— 问卷 → 方案 → 导入 → 撤回这条线上,真正会出错的几处。
 *
 * 教练是**本机**的:状态存在 storage 里,方案由生成器算出来。这里不测 UI,
 * 只测那些一旦错了用户会直接看见的结论:周安排怎么铺、限制动作有没有真的避开、
 * 导入时不换周计划会不会把日程清空、改一句话到底改到了什么、坏数据会不会把页面卡死。
 *
 * 用法:`npm run smoke -- coach`
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// coach.ts 经 Taro 读写本机存储;这套测试用内存 Map 代替
const store = new Map();
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    const storage = {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => store.set(k, v),
      removeStorageSync: (k) => store.delete(k)
    };
    return { default: storage, ...storage };
  }
  return origLoad.call(this, req, ...rest);
};

const C = require('../.smoke/pkg-exercise/engine/coach.js');
const { scheduleOf } = require('../.smoke/pkg-exercise/engine/schedule.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const profile = (patch = {}) => ({
  goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek: 3, sessionMin: 45, preferredDays: [0, 2, 4], limitations: '',
  ...patch
});

section('一周怎么铺');
(() => {
  const week = C.buildWeek(['a', 'b', 'c'], [0, 2, 4]);
  ok('点了哪几天就排哪几天', week[0].includes('a') && week[2].includes('b') && week[4].includes('c'));
  ok('没点的日子是休息日', [1, 3, 5, 6].every((d) => week[d].length === 0));
})();
(() => {
  const week = C.buildWeek(['a', 'b', 'c'], [0, 1, 2, 3]);
  ok('点的日子比训练日多 → 只用前几个', week[0].includes('a') && week[1].includes('b') && week[2].includes('c') && week[3].length === 0);
})();
(() => {
  const week = C.buildWeek(['a', 'b', 'c', 'd'], []);
  ok('没点日子 → 按默认铺法(4 练:一、二、四、五)', [0, 1, 3, 4].every((d) => week[d].length === 1));
})();
(() => {
  const week = C.buildWeek(['a', 'b', 'c'], [6]);
  ok('点得不够 → 剩下的按默认铺,不把两套塞进同一天', week.flat().length === 3 && new Set(week.flat()).size === 3);
})();

section('想避开的动作');
ok('逗号/顿号/分号都能分', C.parseLimitations('引体向上、硬拉;不要深蹲').length === 3);
ok('剥掉「不要/避开」这种前缀', C.parseLimitations('不要硬拉')[0] === '硬拉');
ok('太短的不认(「a」不像动作名)', C.parseLimitations('a,深蹲').length === 1);
(() => {
  const p = C.makeProposal(profile(), 1);
  const firstName = p.plan.days[0].items[0].nameZh;
  const avoided = C.makeProposal(profile({ limitations: firstName }), 1);
  const names = avoided.plan.days.flatMap((d) => d.items.map((it) => it.nameZh));
  ok('写了要避开的动作,方案里就没有了', !names.includes(firstName), firstName);
})();

section('排出来的那一版');
(() => {
  const p = C.makeProposal(profile(), 1);
  ok('训练日数和问卷一致', p.plan.days.length === 3, `${p.plan.days.length} 天`);
  ok('带了一份固定周日程', p.plan.schedule?.mode === 'week');
  ok('轮转顺序就是训练日顺序', JSON.stringify(p.plan.schedule.rotation) === JSON.stringify(p.plan.days.map((d) => d.key)));
  ok('周安排里每套训练日刚好出现一次', p.plan.schedule.week.flat().length === p.plan.days.length);
  ok('每个训练日都有至少两个动作', p.plan.days.every((d) => d.items.length >= 2));
  ok('状态是待决定', p.status === 'pending');
  ok('summary 说得出目标与天数', p.summary.includes('增肌') && p.summary.includes('每周 3 练'), p.summary);
})();
(() => {
  const a = C.makeProposal(profile(), 1);
  const b = C.makeProposal(profile(), 1);
  const shape = (p) => JSON.stringify(p.plan.days.map((d) => [d.key, d.items.map((it) => it.exerciseId)]));
  ok('同样的回答排出同样的动作(不会每次都换一批)', shape(a) === shape(b));
})();
(() => {
  const p = C.makeProposal(profile({ limitations: '引体向上' }), 1);
  const last = p.plan.lastNote;
  ok('方案备注里写清避开了什么', last.includes('引体向上'), last);
})();

section('导入时换不换周计划');
(() => {
  const p = C.makeProposal(profile(), 1);
  const keys = p.plan.days.map((d) => d.key);
  const old = {
    id: 'old', days: [{ key: 'push' }, { key: 'pull' }],
    schedule: { mode: 'week', week: [[], ['push'], [], ['pull'], [], [], []], rotation: ['push', 'pull'] }
  };
  const s = C.scheduleForImport(old, p.plan);
  ok('老周计划和新训练日对不上 → 退回轮转,而不是留一张空周表', s.mode === 'rotation');
  ok('退回轮转时用的是新方案的全部训练日', JSON.stringify(s.rotation) === JSON.stringify(keys));
})();
(() => {
  const p = C.makeProposal(profile(), 1);
  const [k1, k2] = p.plan.days.map((d) => d.key);
  const old = {
    id: 'old', days: [{ key: k1 }, { key: k2 }],
    schedule: { mode: 'week', week: [[k1], [], [k2], [], [], [], []], rotation: [k1, k2] }
  };
  const s = C.scheduleForImport(old, p.plan);
  ok('新方案沿用了老的训练日 key → 周计划原样保留', s.mode === 'week' && s.week[0].includes(k1) && s.week[2].includes(k2));
})();

section('改一句话');
(() => {
  const { profile: p, changes } = C.refineProfile(profile(), '每周 4 练');
  ok('「每周 4 练」改到天数', p.daysPerWeek === 4 && changes.length === 1, changes.join('、'));
})();
(() => {
  const { profile: p } = C.refineProfile(profile(), '单次 40 分钟');
  ok('「40 分钟」改到单次时长', p.sessionMin === 40);
})();
(() => {
  const { profile: p } = C.refineProfile(profile({ goal: 'fatloss' }), '我想增肌');
  ok('目标能被一句话改掉', p.goal === 'muscle');
})();
(() => {
  const { profile: p } = C.refineProfile(profile(), '换哑铃吧');
  ok('器械能被一句话改掉', p.access === 'dumbbell');
})();
(() => {
  const { profile: p } = C.refineProfile(profile(), '尽量排周末');
  ok('「排周末」落到周六、周日', JSON.stringify(p.preferredDays) === JSON.stringify([5, 6]));
})();
(() => {
  const { changes } = C.refineProfile(profile(), '你觉得我该怎么练');
  ok('听不懂的话不硬猜,返回空改动', changes.length === 0);
  ok('空改动时给得出听得懂的例句', C.REFINE_HINT.includes('每周 4 练'));
})();

section('存 / 读 / 坏数据');
ok('第一次打开有一条开场白', C.loadCoach().messages.length === 1);
(() => {
  const s = C.loadCoach();
  const p = C.makeProposal(profile(), 2);
  const loaded = { ...s, profile: profile(), pending: { ...p, status: 'imported', prevPlan: p.plan } };
  C.saveCoach(loaded);
  const back = C.loadCoach();
  ok('方案和问卷存得住', back.pending?.iteration === 2 && back.profile?.goal === 'muscle');
  ok('导入前的旧计划也存得住(撤回要靠它)', !!back.pending?.prevPlan?.days?.length);
})();
(() => {
  store.set('bodyos.training.coach', { profile: { goal: '瞎写' }, messages: '坏了', pending: { plan: {} } });
  const s = C.loadCoach();
  ok('坏档案 → 问卷重来,而不是卡在半份数据上', s.profile === null);
  ok('坏对话记录 → 不渲染垃圾消息', s.messages.length === 1);
  ok('坏提案 → 丢弃,不会渲染到一半抛错', s.pending === null);
})();

section('所有问卷组合');
(() => {
  const bad = [];
  for (const goal of ['fatloss', 'muscle', 'endurance']) {
    for (const level of ['beginner', 'intermediate']) {
      for (const access of ['body', 'dumbbell', 'home', 'gym']) {
        for (const daysPerWeek of [2, 3, 4, 5, 6]) {
          const p = C.makeProposal(profile({ goal, level, access, daysPerWeek, sessionMin: 30 }), 1);
          const inWeek = p.plan.schedule.week.flat().length;
          // 动作库太薄时个别训练日会被丢掉(少于两个动作不输出),但一份「导入就能练」的方案
          // 至少要留两套,而且周安排里每套都得出现且只出现一次。
          if (p.plan.days.length < 2 || inWeek !== p.plan.days.length) {
            bad.push(`${goal}/${level}/${access}/${daysPerWeek} 练 → ${p.plan.days.length} 天 ${inWeek} 排`);
          }
        }
      }
    }
  }
  ok('18 种目标 × 经验 × 器械 × 天数组合都能排出可导入的方案', bad.length === 0, bad.slice(0, 3).join('; '));
})();

section('文案红线');
(() => {
  const p = C.makeProposal(profile(), 1);
  const intake = C.intakeLines(profile()).join('\n');
  const text = [C.emptyCoach().messages[0].text, intake, p.summary, p.basedOn, p.plan.lastNote, C.REFINE_HINT].join('\n');
  ok('教练说的话里没有禁词(AI/智能/大模型/智谱)', !/AI|智能|大模型|智谱/.test(text));
  ok('问卷摘要说得清楚答了什么', intake.includes('目标') && intake.includes('器械'), intake.split('\n')[0]);
})();

console.log(fail ? `\n教练:${fail} 条失败` : '\n教练:全过');
process.exit(fail ? 1 : 0);
