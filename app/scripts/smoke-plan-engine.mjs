/* 生成器 + 渐进引擎冒烟测试(编译产物在 .smoke/) */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* mock Taro:引擎模块(store/fav/custom…)会 import 它,而真 Taro 在 Node 下起不来
   (它要小程序编译期注入的常量)。mock 必须在 require 引擎模块**之前**装好。 */
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

const { generatePlan, findExercise } = require('../.smoke/pkg-exercise/data/../engine/generator.js'.replace('/data/../', '/'));
const { applyWorkout } = require('../.smoke/pkg-exercise/engine/progression.js');

const show = (plan) => {
  console.log(`\n### ${plan.goal}/${plan.level}/${plan.access} 每周${plan.daysPerWeek}天 单次${plan.sessionMin}min → ${plan.days.length} 个训练日`);
  for (const d of plan.days) {
    console.log(`\n[${d.title}] ${d.focus} 约${d.estMin}分钟`);
    for (const it of d.items) {
      const ex = findExercise(it.exerciseId);
      const w = it.weightKg == null ? '自重' : it.weightKg + 'kg';
      console.log(`  ${it.nameZh} | ${ex?.equipment} | ${it.sets}×${it.repsMin}-${it.repsMax} ${w} 休息${it.restSec}s [${it.progression}] 备选${it.alternates.length}`);
    }
  }
};

// 场景1: 纯徒手·新手·减脂·每周3天
const p1 = generatePlan({ goal: 'fatloss', level: 'beginner', access: 'body', daysPerWeek: 3, sessionMin: 30 });
show(p1);

// 场景2: 哑铃·进阶·增肌·每周4天
const p2 = generatePlan({ goal: 'muscle', level: 'intermediate', access: 'dumbbell', daysPerWeek: 4, sessionMin: 45 });
show(p2);

// 场景3: 健身房·进阶·增肌·每周5天
const p3 = generatePlan({ goal: 'muscle', level: 'intermediate', access: 'gym', daysPerWeek: 5, sessionMin: 60 });
show(p3);

// 渐进引擎: 用 p2 第一天模拟两轮训练
const day = p2.days[0];
let prog = {};
for (let round = 1; round <= 2; round++) {
  const entries = day.items.map((it) => ({
    exerciseId: it.exerciseId,
    sets: Array.from({ length: it.sets }, () => ({
      reps: round === 1 ? it.repsMin : it.repsMax,           // 第1轮刚到下限,第2轮全到上限
      weightKg: it.weightKg,
      done: true
    }))
  }));
  const r = applyWorkout(p2, day.key, entries, 40 * 60, prog);
  prog = r.next;
  console.log(`\n--- 第${round}轮后 notes:`);
  r.notes.forEach((n) => console.log('   ', n));
  console.log('    日志:', r.log.totalSets, '组', r.log.totalReps, '次', r.log.totalVolumeKg, 'kg容量');
}
// 第3轮故意不达标×2 → 触发减载
for (let round = 3; round <= 4; round++) {
  const entries = day.items.map((it) => ({
    exerciseId: it.exerciseId,
    sets: Array.from({ length: it.sets }, () => ({ reps: Math.max(2, it.repsMin - 5), weightKg: it.weightKg, done: true }))
  }));
  const r = applyWorkout(p2, day.key, entries, 40 * 60, prog);
  prog = r.next;
  console.log(`--- 第${round}轮(未达标) notes:`);
  r.notes.forEach((n) => console.log('   ', n));
}
