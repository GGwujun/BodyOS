/**
 * M10.4 「这次不算进步」冒烟测试。
 *
 * 这条规则的要害是**它只挡住一半**:挡住「拿这次去调下次目标」,
 * 挡不住「那天确实练了」。所以每个用例都在验两件事里的一件 ——
 * 要么「它不该算的没算」,要么「它该留的还在」。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-noprog.mjs
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
const H = require(`${E}history.js`);
const M = require(`${E}max.js`);
const S = require(`${E}strength.js`);
const SC = require(`${E}share-card.js`);
const PROG = require(`${E}progression.js`);

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const set = (reps, weightKg, rir = 2) => ({ reps, weightKg, rir });
const log = (date, entries, extra = {}) => {
  const sets = entries.flatMap((e) => e.sets);
  return {
    id: `wo-${date}`, planId: 'p', dayKey: 'd', dayTitle: '练', date,
    durationSec: 3600,
    totalSets: sets.length,
    totalReps: sets.reduce((n, s) => n + s.reps, 0),
    totalVolumeKg: Math.round(sets.reduce((n, s) => n + s.reps * (s.weightKg ?? 0), 0)),
    avgRir: null,
    entries,
    ...extra
  };
};
const bench = (reps, w) => ({ exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(reps, w), set(reps, w), set(reps, w)] });

/* ================= 规则本身 ================= */
section('哪条日志能拿来判断进步');
ok('正常练的一次 → 能', T.countsForProgress(log('2026-10-01', [bench(8, 60)])) === true);
ok('补录的 → 不能(数据记不准)', T.countsForProgress(log('2026-10-01', [bench(8, 60)], { manual: true })) === false);
ok('标了不算进步的 → 不能(数据准,但那次不算数)', T.countsForProgress(log('2026-10-01', [bench(8, 60)], { noProg: true })) === false);
ok('两个都标了也只是不能', T.countsForProgress(log('2026-10-01', [bench(8, 60)], { manual: true, noProg: true })) === false);
ok('null / undefined 不炸,按不能算', T.countsForProgress(null) === false && T.countsForProgress(undefined) === false);

/* ================= 渐进推导 ================= */
section('开始了「不算进步」的这次,下次目标一动不动');
// 造一个两动作的小计划,便于断言
const plan = {
  id: 'p', createdAt: 'x', goal: 'muscle', level: 'beginner', access: 'dumbbell',
  daysPerWeek: 2, sessionMin: 40, doneCount: 0, lastNote: 'x',
  days: [{
    key: 'a', title: '全身 A', focus: '', estMin: 40,
    items: [
      { exerciseId: '0025', nameZh: '杠铃卧推', sets: 3, repsMin: 8, repsMax: 10, weightKg: 60, weightStepKg: 2.5, restSec: 90, progression: 'double', alternates: [] },
      { exerciseId: '0043', nameZh: '杠铃深蹲', sets: 3, repsMin: 8, repsMax: 10, weightKg: 80, weightStepKg: 5, restSec: 120, progression: 'double', alternates: [] }
    ]
  }]
};
const entriesAt = (reps) => plan.days[0].items.map((it) => ({
  exerciseId: it.exerciseId,
  sets: Array.from({ length: it.sets }, () => ({ reps, weightKg: it.weightKg, done: true, rir: 2 }))
}));

{
  // 先正常练两次,把状态推到「该加重」的位置
  let st = PROG.applyWorkout(plan, 'a', entriesAt(10), 2400, {}).next;
  const before = JSON.stringify(st);
  // 第三次标为不算进步 —— 哪怕次数全部达标,也不许改状态
  const r = PROG.applyWorkout(plan, 'a', entriesAt(10), 2400, st, '', true);
  ok('下次目标一个字节都没动', JSON.stringify(r.next) === before, JSON.stringify(r.next));
  ok('不给「下次目标已更新」那种话术', r.notes.length === 0, JSON.stringify(r.notes));
  ok('日志上留下了这次不算进步的标记', r.log.noProg === true);
  ok('组数/次数/容量照常算 —— 那天确实练了', r.log.totalSets === 6 && r.log.totalReps === 60 && r.log.totalVolumeKg === 60 * 30 + 80 * 30,
    `${r.log.totalSets}/${r.log.totalReps}/${r.log.totalVolumeKg}`);
  ok('日志里每组数据都还在', r.log.entries.length === 2 && r.log.entries[0].sets.length === 3);
}
{
  // 不传这个开关时行为不变(默认 false,老调用方不用改)
  const r = PROG.applyWorkout(plan, 'a', entriesAt(10), 2400, {});
  ok('不传开关时仍是原来的行为(照样推导)', r.notes.length > 0 && r.log.noProg === undefined, JSON.stringify(r.notes));
}
{
  const st = PROG.applyWorkout(plan, 'a', entriesAt(10), 2400, {}).next;
  const r = PROG.applyWorkout(plan, 'a', entriesAt(10), 2400, st, '今天腰有点紧', true);
  ok('感受备注照样记下来', r.log.note === '今天腰有点紧' && r.log.noProg === true);
}

/* ================= 单动作的「不算进步」 ================= */
/* 和整场那个是同一件事的两个粒度。这里每条都验两遍:「它不该算的没算」
   和「同一场里别的动作照算」—— 后者才是这个粒度存在的理由,只验前者的用例
   会让「把整场一起作废」的实现也通过。 */
section('单个动作标了不算:那个动作目标不动,同场别的照动');
{
  const off = entriesAt(10).map((e, i) => (i === 0 ? { ...e, noProg: true } : e));
  const r = PROG.applyWorkout(plan, 'a', entriesAt(10), 2400, {}).next;
  const before = JSON.stringify(r);
  const out = PROG.applyWorkout(plan, 'a', off, 2400, r);
  ok('被标的那个动作:目标一个字节都没动', JSON.stringify(out.next['0025']) === JSON.stringify(r['0025']),
    JSON.stringify(out.next['0025']));
  ok('同场没标的动作:**照常推导**', JSON.stringify(out.next['0043']) !== JSON.stringify(r['0043']),
    JSON.stringify(out.next['0043']));
  ok('变化汇总里只提了没标的那个', out.notes.length === 1 && out.notes[0].includes('深蹲'),
    JSON.stringify(out.notes));
  ok('日志上给这一条留了标记', out.log.entries.find((e) => e.exerciseId === '0025').noProg === true);
  ok('另一条没有这个字段(老形状不变)', out.log.entries.find((e) => e.exerciseId === '0043').noProg === undefined);
  ok('整场不算的开关**没有**被顺手打开', out.log.noProg === undefined);
  ok('组数/容量照常算 —— 那天确实练了', out.log.totalSets === 6 && out.log.totalVolumeKg === 60 * 30 + 80 * 30,
    `${out.log.totalSets}/${out.log.totalVolumeKg}`);
}
{
  // 老日志没有这个字段 —— 缺省必须是「算」,不然所有历史数据一起缩水
  const old = { ...bench(10, 60) };
  ok('老条目没这个字段 → 照常算', old.noProg === undefined
    && PROG.applyWorkout(plan, 'a', entriesAt(10), 2400, {}).notes.length > 0);
}
{
  // 计划外的动作(「换个动作」换来的、「加练一个动作」插进来的)本来就不推导:
  // 换上来的动作 `exerciseId` 在计划里查不到,`applyWorkout` 的 `item` 是 undefined。
  // 所以开关**不该露出来** —— 露了它,用户点一下以为自己排除了那个动作,其实本来就没在算账
  // (见 engine/progression.canProgress,页面那个条件用的就是它)
  ok('计划里有的动作 → 页面该露出这个开关', PROG.canProgress(plan.days[0], '0025') === true);
  ok('计划外的动作 → 不露(推不动,摆了也是骗人)', PROG.canProgress(plan.days[0], '0001') === false);
  const stray = PROG.applyWorkout(plan, 'a',
    [bench(10, 60), { exerciseId: '0001', nameZh: '计划外动作', sets: [{ reps: 10, weightKg: 20, done: true, rir: 2 }], noProg: true }],
    2400, {});
  ok('计划外的动作即便标了也不算目标(本来就没有它的处方)', stray.next['0001'] === undefined);
  ok('但它仍然进日志 —— 练了就是练了', stray.log.entries.some((e) => e.exerciseId === '0001'));
}

/* ================= 纪录 ================= */
section('纪录:不算进步的那次不刷新纪录');
{
  // 10-01 正常 60kg,10-02 标了不算但举了 100kg
  const logs = [
    log('2026-10-01', [bench(8, 60)]),
    log('2026-10-02', [bench(5, 100)], { noProg: true })
  ];
  const prs = H.personalRecords(logs);
  const p = prs.find((x) => x.exerciseId === '0025');
  ok('纪录还是 60kg 那次(100kg 那次被挡在门外)', p.topKg === 60, String(p.topKg));
  ok('纪录日期也没被改到 10-02', p.date === '2026-10-01', p.date);
  ok('补录的同样挡在门外(老规矩没被改坏)', H.personalRecords([...logs, log('2026-10-03', [bench(5, 200)], { manual: true })]).find((x) => x.exerciseId === '0025').topKg === 60);
}
{
  const logs = [log('2026-10-01', [bench(5, 100)], { noProg: true })];
  ok('只有不算进步的那几次时,这个动作干脆没有纪录(不拿它当成绩)', H.personalRecords(logs).length === 0);
}
section('纪录:只标了「这个动作不算」的那一条,同样不许刷新纪录');
{
  // 同一场里两个动作:卧推标了不算(它举了 100),深蹲没标(它举了 80)
  const mixed = {
    ...log('2026-10-02', [
      { exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(5, 100)], noProg: true },
      { exerciseId: '0043', nameZh: '杠铃深蹲', sets: [set(5, 80)] }
    ])
  };
  const prs = H.personalRecords([log('2026-10-01', [bench(8, 60)]), mixed]);
  const b = prs.find((x) => x.exerciseId === '0025');
  ok('卧推的纪录还是 10-01 的 60kg(100kg 那次被挡下)', b.topKg === 60 && b.date === '2026-10-01', `${b.topKg}/${b.date}`);
  ok('…但那次仍然进了容量统计(数据是真的)', H.summaryOf([mixed]).volumeKg === 100 * 5 + 80 * 5,
    String(H.summaryOf([mixed]).volumeKg));
  ok('同场没标的动作照常记成绩', prs.find((x) => x.exerciseId === '0043').topKg === 80);
  // 分享卡靠 `personalRecords` 挡住,所以那条路不用单独改 —— 但**粒度**要看准:
  // 该消失的只有卧推那一条,同场没标的深蹲照旧该宣称刷新(整场作废才是错的)
  const txt = SC.prTextOf(mixed, prs) ?? '';
  ok('分享卡不再宣称卧推刷新纪录', !txt.includes('卧推'), txt);
  ok('…但同场没标的深蹲照常宣称(排除的是一个动作,不是整场)', txt.includes('深蹲'), txt);
}
section('参照行:标了不算的那次不进「最好」,但仍是「上次」');
{
  const mixed = log('2026-10-02', [
    { exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(5, 100)], noProg: true }
  ]);
  const r = H.refLine([log('2026-10-01', [bench(8, 60)]), mixed], '0025', '2026-10-03');
  ok('「最好」还是 10-01 那组 60×8', r.bestText.includes('60'), String(r.bestText));
  ok('「上次」是 10-02 —— 那天确实练了卧推', r.date === '2026-10-02' && r.lastTexts.length === 1,
    `${r.date}/${JSON.stringify(r.lastTexts)}`);
}
section('力量基准与力量保持:只标了单动作不算的那条也不参与');
{
  // 那条被标了不算的**必须给够两组**:`bestE1rmOf` 有一道「至少 2 组才算得出基准」的门
  // (`MIN_SETS_FOR_MAX`)。只给一组的话,它不管标没标都会被跳过 —— 用例照过,
  // 却根本没在验「这个门挡住了它」这件事(变异测试里就是这么露的馅)
  const m = M.syncMaxes([log('2026-10-01', [bench(5, 60)]), log('2026-10-02', [
    { exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(5, 100), set(5, 100)], noProg: true }
  ])], {});
  ok('基准按 60kg 那次估,不是按 100kg 那次', m['0025'].e1rmKg < 80, String(m['0025'].e1rmKg));

  // 存量清理的边界:助力分支会 delete 旧条目,这一条**只跳过、不清**
  const kept = M.syncMaxes([log('2026-10-02', [
    { exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(5, 100)], noProg: true }
  ])], { '0025': { e1rmKg: 65, source: 'log', at: 'x' } });
  ok('已经有基准时,标了不算的那次不会把旧基准抹掉', kept['0025'].e1rmKg === 65, String(kept['0025']?.e1rmKg));

  const s = S.strengthOf([
    log('2026-08-01', [bench(1, 100)]),
    log('2026-10-01', [{ exerciseId: '0025', nameZh: '杠铃卧推', sets: [set(1, 200)], noProg: true }])
  ], '0025', '2026-10-15');
  ok('最好成绩仍是 8-01 的 100kg', s.bestE1rm === 100, String(s.bestE1rm));
  ok('「上次练」仍认 10-01(那天确实练了)', s.lastDate === '2026-10-01', s.lastDate);
  ok('停练天数照 10-01 算(14 天,没被当成没练)', s.restDays === 14 && s.retained === 1, `${s.restDays}/${s.retained}`);
}

/* ================= 该留的必须留下 ================= */
section('那天确实练了 —— 打卡、热力图、曲线一律照收');
{
  const logs = [log('2026-10-01', [bench(8, 60)]), log('2026-10-02', [bench(8, 60)], { noProg: true })];
  const days = H.dayStats(logs);
  ok('打卡算两天(不是一天)', days.length === 2, JSON.stringify(days.map((d) => d.date)));
  ok('还是连续的两天,不算断档', H.heatmap(logs, 26, '2026-10-02').streak === 2, String(H.heatmap(logs, 26, '2026-10-02').streak));
  const pts = H.exerciseHistory(logs, '0025');
  ok('动作曲线两个点都在(它是数据,不是结论)', pts.length === 2, String(pts.length));
  // 两次都算:8 次 × 60kg × 3 组 = 1440,两天共 2880
  ok('容量照常进统计', H.summaryOf(logs).volumeKg === 60 * 8 * 3 * 2, String(H.summaryOf(logs).volumeKg));
}

/* ================= 力量基准 ================= */
section('力量基准:不算进步的那次不参与估算');
{
  const logs = [
    log('2026-10-01', [bench(5, 60)]),
    log('2026-10-02', [bench(5, 100)], { noProg: true })
  ];
  const m = M.syncMaxes(logs, {});
  ok('基准按 60kg 那次估,不是按 100kg 那次', m['0025'].e1rmKg < 80, String(m['0025'].e1rmKg));
}
{
  const m = M.syncMaxes([log('2026-10-01', [bench(5, 100)], { noProg: true })], {});
  ok('只有它时不建基准(宁可不给,也不给一个假的)', !m['0025']);
}

/* ================= 力量保持 ================= */
section('力量保持:不算进步的那次不给成绩,但算「练过」');
{
  // 8-01 正常 100kg,10-01 标了不算但举了 200kg
  const logs = [
    log('2026-08-01', [bench(1, 100)]),
    log('2026-10-01', [bench(1, 200)], { noProg: true })
  ];
  const r = S.strengthOf(logs, '0025', '2026-10-15');
  ok('最好成绩仍是 8-01 的 100kg', r.bestE1rm === 100, String(r.bestE1rm));
  ok('但「上次练」认 10-01 —— 那天确实练了这个动作', r.lastDate === '2026-10-01', r.lastDate);
  ok('于是停练天数照它算(14 天,没掉)', r.restDays === 14 && r.retained === 1, `${r.restDays}/${r.retained}`);
}

/* ================= 分享卡 ================= */
section('分享卡:不宣称刷新纪录');
{
  const logs = [log('2026-10-01', [bench(5, 60)]), log('2026-10-02', [bench(5, 100)], { noProg: true })];
  const prs = H.personalRecords(logs);
  const bad = logs[1];
  ok('同一天另有一次真纪录时才敢说刷新', SC.prTextOf(bad, prs) === null, String(SC.prTextOf(bad, prs)));
  ok('正常那次照常说', SC.prTextOf(logs[0], H.personalRecords([logs[0]])) !== null);
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
