/**
 * 首页小抄的「今天这一摊」—— 补录/编辑日志之后必须用同一套判断重写,
 * 否则把今天的日志改到昨天以后,首页还会写着「今天练完了」。
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const mem = new Map();
const storage = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => mem.delete(k)
};
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: storage, ...storage };
  return origLoad.call(this, req, ...rest);
};

const { generatePlan } = require('../.smoke/pkg-exercise/engine/generator.js');
const { todayDigest } = require('../.smoke/pkg-exercise/engine/digest.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

const plan = generatePlan({ goal: 'fatloss', level: 'beginner', access: 'body', daysPerWeek: 3, sessionMin: 30 });
const today = '2026-10-17';
const day = plan.days[0];
const log = (date) => ({
  id: `l-${date}`, planId: plan.id, dayKey: day.key, dayTitle: day.title, date,
  startedAt: `${date}T12:00:00.000Z`, durationSec: 1800, totalSets: 3,
  totalReps: 30, totalVolumeKg: 600, avgRir: null, entries: []
});

const before = todayDigest(plan, [], {}, {}, today);
ok('还没练 → 今天要练(todo)', before.state === 'todo', before.state);
ok('训练日带上了', before.dayKey === day.key && before.title === day.title);

const done = todayDigest(plan, [log(today)], {}, {}, today);
ok('今天练了 → done', done.state === 'done', done.state);

// 这条日志被编辑挪到昨天:今天没有日志了,小抄不能再写「练完了」
const moved = todayDigest(plan, [log('2026-10-16')], {}, {}, today);
ok('日志挪到昨天后 → 不再说今天练完了', moved.state !== 'done', moved.state);

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
