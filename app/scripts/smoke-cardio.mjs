/**
 * M9.1a 有氧距离/配速/爬升 冒烟测试 —— 全是纯函数,直接 require 编译产物。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-cardio.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../.smoke/utils/cardio.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

section('哪些运动要问距离');
ok('跑步是配速', C.cardioOf('跑步')?.kind === 'pace' && C.cardioOf('跑步')?.unit === '公里');
ok('骑行是速度,不是配速', C.cardioOf('骑行')?.kind === 'speed');
ok('游泳按百米算(泳池里没人说「每公里配速」)', C.cardioOf('游泳')?.per === 100 && C.cardioOf('游泳')?.unit === '100 米');
ok('力量/瑜伽/跳绳不问距离', C.cardioOf('力量训练') === null && C.cardioOf('瑜伽') === null && C.cardioOf('跳绳') === null);
ok('没见过的类型也不会崩', C.cardioOf('') === null && C.cardioOf('遛狗') === null);

section('距离输入');
ok('整数公里', C.parseDistanceKm('5') === 5000);
ok('小数公里', C.parseDistanceKm('5.2') === 5200, String(C.parseDistanceKm('5.2')));
ok('中文逗号当小数点(中文输入法很容易打出来)', C.parseDistanceKm('5，2') === 5200);
ok('带单位也认', C.parseDistanceKm('5.2公里') === 5200 && C.parseDistanceKm('5.2km') === 5200);
ok('两边空格无所谓', C.parseDistanceKm('  5.2  ') === 5200);
ok('几位小数都收,落到米', C.parseDistanceKm('5.123') === 5123);
ok('空的返回 null,不是 0', C.parseDistanceKm('') === null && C.parseDistanceKm('   ') === null);
ok('零/负数不收', C.parseDistanceKm('0') === null && C.parseDistanceKm('-3') === null);
ok('胡说八道不收', C.parseDistanceKm('五公里') === null && C.parseDistanceKm('abc') === null);
ok('跟体重串了的数字要挡住', C.parseDistanceKm('75000') === null, '75000 公里显然不是跑步');
ok('500 公里是上限', C.parseDistanceKm('500') === 500000 && C.parseDistanceKm('501') === null);

section('距离说成人话');
ok('不到一公里说米', C.distanceText(800) === '800 米', C.distanceText(800));
ok('刚过一公里', C.distanceText(1000) === '1.0 公里', C.distanceText(1000));
ok('5 公里', C.distanceText(5200) === '5.2 公里');
ok('半马不四舍五入成一万米', C.distanceText(21097) === '21.1 公里', C.distanceText(21097));
ok('长距离收掉小数(100 公里以上不装精确)', C.distanceText(102400) === '102 公里', C.distanceText(102400));
ok('没有距离就空着,不显示 0 米', C.distanceText(0) === '' && C.distanceText(null) === '' && C.distanceText(undefined) === '');

section('配速');
ok('30 分钟 5 公里 = 6\'00"', C.paceText('跑步', 30, 5000) === "6'00\"/公里", C.paceText('跑步', 30, 5000));
ok('24 分钟 4 公里 = 6\'00"', C.paceText('跑步', 24, 4000) === "6'00\"/公里");
ok('不是整分钟也准(20 分钟 3.5 公里 = 5\'43")', C.paceText('跑步', 20, 3500) === "5'43\"/公里", C.paceText('跑步', 20, 3500));
ok('秒数补零(1 小时 10 公里 = 6\'00")', C.paceText('跑步', 60, 10000) === "6'00\"/公里");
ok('游泳按百米(20 分钟 1000 米 = 2\'00"/100 米)', C.paceText('游泳', 20, 1000) === "2'00\"/100 米", C.paceText('游泳', 20, 1000));
ok('骑行给速度不给配速(1 小时 20 公里 = 20 公里/小时)', C.paceText('骑行', 60, 20000) === '20.0 公里/小时', C.paceText('骑行', 60, 20000));
ok('缺时长 → 空(不是 Infinity)', C.paceText('跑步', null, 5000) === '' && C.paceText('跑步', undefined, 5000) === '');
ok('缺距离 → 空(不是 0\'00")', C.paceText('跑步', 30, null) === '' && C.paceText('跑步', 30, 0) === '');
ok('不问距离的运动 → 空', C.paceText('力量训练', 30, 5000) === '');
ok('荒唐配速宁可不说:0.1 公里练了 2 小时', C.paceText('跑步', 120, 100) === '', C.paceText('跑步', 120, 100));
ok('荒唐配速:1 分钟跑 5 公里', C.paceText('跑步', 1, 5000) === '', '这不是跑步,是打字打错了');
ok('走路 20 分钟/公里还在合理范围', C.paceText('快走', 100, 5000) === "20'00\"/公里", C.paceText('快走', 100, 5000));
ok('秒数不出现负零', !C.mmss(3600).includes('-') && C.mmss(3600) === "60'00\"");

section('跑步机坡度(口径同 openGym 的 incline)');
ok('坡度说成「坡度 6%」', C.inclineText(6) === '坡度 6%', C.inclineText(6));
ok('半格照显示', C.inclineText(6.5) === '坡度 6.5%');
ok('0 什么都不说(平地不用特意交代「坡度 0%」)', C.inclineText(0) === '' && C.inclineText(null) === '');
ok('负数不显示(跑步机没有负坡度)', C.inclineText(-3) === '');
ok('上限是 40%(和 openGym 一致)', C.MAX_INCLINE_PCT === 40);
ok('填 6 就是 6', C.parseIncline('6') === 6);
ok('带百分号也认', C.parseIncline('6%') === 6 && C.parseIncline('6％') === 6);
ok('小数照收', C.parseIncline('6.5') === 6.5);
ok('中文小数点', C.parseIncline('6．5') === 6.5);
ok('落不到半格往上靠一格(跑步机没 6.3 这一档)', C.parseIncline('6.3') === 6.5, String(C.parseIncline('6.3')));
ok('空的/0 返回 null(平地不存 0,省得每次判断)', C.parseIncline('') === null && C.parseIncline('0') === null);
ok('超过 40 不收', C.parseIncline('45') === null && C.parseIncline('40') === 40);
ok('胡说八道不收', C.parseIncline('陡') === null && C.parseIncline('6%%') === null);

section('列表第二行');
ok('距离 + 配速 + 坡度拼起来', C.cardioSubText('跑步', 30, 5200, 6) === "5.2 公里 · 5'46\"/公里 · 坡度 6%", C.cardioSubText('跑步', 30, 5200, 6));
ok('只有距离也只显示距离', C.cardioSubText('跑步', null, 5200, null) === '5.2 公里');
ok('什么都没有就是空串(界面跳过这一行)', C.cardioSubText('力量训练', 30, null, null) === '');
ok('力量训练记录上挂着距离也不显示(说不通的东西宁可不显示)',
  C.cardioSubText('力量训练', 30, 5200, 6) === '', C.cardioSubText('力量训练', 30, 5200, 6));
ok('瑜伽同理', C.cardioSubText('瑜伽', 30, 5200, null) === '');

section('消耗估算(只在用户没填时兜底)');
ok('65kg 跑 30 分钟 ≈ 334 kcal', C.estimateCalories('跑步', 30, 65) === 334, String(C.estimateCalories('跑步', 30, 65)));
ok('体重越大消耗越多', C.estimateCalories('跑步', 30, 90) > C.estimateCalories('跑步', 30, 60));
ok('走路比跑步少', C.estimateCalories('快走', 30, 65) < C.estimateCalories('跑步', 30, 65));
ok('没填体重按 65 算,不返回 null', C.estimateCalories('跑步', 30, null) === 334);
ok('瑜伽这种没 MET 表的返回 null(不编数字)', C.estimateCalories('瑜伽', 30, 65) === null);
ok('时长不合理返回 null', C.estimateCalories('跑步', 0, 65) === null && C.estimateCalories('跑步', -5, 65) === null);

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
