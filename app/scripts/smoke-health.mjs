/**
 * 身体指标口径冒烟 —— 重点盯住 BMR 的性别常数:
 * 客户端的计划页和后端引擎必须逐字同口径,否则同一份资料会算出两个消耗。
 * 用法:npx tsc -p tsconfig.smoke.json && node scripts/smoke-health.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const H = require('../.smoke/utils/health.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

section('BMR:Mifflin-St Jeor 三种性别口径与后端一致');
const base = { age: 30, heightCm: 175, weightKg: 70 };
ok('男 = base + 5', H.calcBmr({ ...base, gender: 'male' }) === 1648.75, String(H.calcBmr({ ...base, gender: 'male' })));
ok('女 = base - 161', H.calcBmr({ ...base, gender: 'female' }) === 1482.75, String(H.calcBmr({ ...base, gender: 'female' })));
ok(
  '未提供/其他取中点 = base - 78(不是按男性算)',
  H.calcBmr({ ...base, gender: 'other' }) === 1565.75,
  String(H.calcBmr({ ...base, gender: 'other' }))
);
ok('不传性别也走中性常数,不默认成男性', H.calcBmr(base) === H.calcBmr({ ...base, gender: 'other' }));

section('缺资料返回 null,不拿默认值冒充');
ok('缺体重', H.calcBmr({ ...base, gender: 'male', weightKg: null }) === null);
ok('缺身高', H.calcBmr({ ...base, gender: 'male', heightCm: null }) === null);
ok('缺年龄', H.calcBmr({ ...base, gender: 'male', age: null }) === null);

section('BMI 只认有效正数');
ok('正常值', Math.round(H.bmiOf(70, 175) * 10) / 10 === 22.9);
ok('缺一项就是 null', H.bmiOf(null, 175) === null && H.bmiOf(70, 0) === null);

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
