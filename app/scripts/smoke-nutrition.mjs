/**
 * 三大营养素那两口「口径锅」的冒烟测试。
 *
 * 这些函数吐出来的东西**直接进用户眼睛**:「蛋白 82g · 碳水 210g · 脂肪 52g」、
 * 「蛋白 18% · 碳水 52% · 脂肪 30%」、「离每天 105g 的目标还差约 23g」。
 * 它们算错不会崩 —— 只是安静地说假话,而且没人看得出来。
 * 所以这里钉的是四件事:
 *   1. **分母** —— 日均除以有记录的天数,没记的那天不能当 0 摊进去(和热量那块同一套);
 *   2. **按热量不按克数** —— 脂肪 9 千卡/克、碳水 4,占比必须这么算;
 *   3. **三个 0 与「假 0」** —— 手动只填热量的记录克数是 0,不能摆出来当吃了 0 克蛋白;
 *   4. **够与不够** —— 差 5 克别提(噪音),差 10 克以上才说。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-nutrition.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 纯函数,不碰 Taro —— 不用打桩 storage
const N = require('../.smoke/utils/nutrition.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const eq = (name, actual, expected) => ok(name, actual === expected, actual === expected ? '' : `实际 ${JSON.stringify(actual)},期望 ${JSON.stringify(expected)}`);
const section = (t) => console.log(`\n--- ${t} ---`);

section('加起来');
const day1 = { proteinG: 30, carbG: 80, fatG: 20 };
const day2 = { proteinG: 52, carbG: 130, fatG: 32 };
const sum = N.sumMacros([day1, day2]);
eq('两天相加', JSON.stringify(sum), JSON.stringify({ proteinG: 82, carbG: 210, fatG: 52 }));
eq('空数组加起来是 0', JSON.stringify(N.sumMacros([])), JSON.stringify({ proteinG: 0, carbG: 0, fatG: 0 }));
eq('缺字段的行当 0', JSON.stringify(N.sumMacros([{ proteinG: 10 }])), JSON.stringify({ proteinG: 10, carbG: 0, fatG: 0 }));
eq('Null 当 0 而不是崩', JSON.stringify(N.sumMacros([null, day1])), JSON.stringify(day1));
// 服务端 Json 列读出来是 unknown,NaN 也是可能出现的
eq('NaN 当 0', JSON.stringify(N.sumMacros([{ proteinG: NaN, carbG: '80', fatG: 9 }])), JSON.stringify({ proteinG: 0, carbG: 0, fatG: 9 }));

section('日均:分母是有记录的天数');
const avg = N.avgMacros([day1, day2], 2);
eq('两天的日均', JSON.stringify(avg), JSON.stringify({ proteinG: 41, carbG: 105, fatG: 26 }));
// 窗口 7 天只记了 2 天 —— 分母必须是 2。除以 7 会把均数砍到三分之一,
// 页面上就变成「日均蛋白 11.7g」,那是句假话
eq('七天窗口只记两天,除以 2 不是 7', JSON.stringify(N.avgMacros([day1, day2], 2)), JSON.stringify({ proteinG: 41, carbG: 105, fatG: 26 }));
eq('一天都没记 → null(不是 0)', N.avgMacros([], 0), null);
eq('days 传负数是 null 不是 Infinity', N.avgMacros([day1], -1), null);

section('有没有真克数(防「假 0」)');
ok('带克数的行 → true', N.anyMacros([day1]));
ok('手动只填热量的行 → false', !N.anyMacros([{ proteinG: 0, carbG: 0, fatG: 0 }]));
ok('全是 0 的行 → false', !N.anyMacros([null, undefined, {}]));
ok('一整天只有一条带克数也算 → true', N.anyMacros([{ proteinG: 0, carbG: 0, fatG: 0 }, { proteinG: 5 }]));

section('供能占比:按热量,不按克数');
// 蛋白 25g=100 千卡、碳水 25g=100 千卡、脂肪 25g=225 千卡 → 合计 425
// 按克数会算成「各占三分之一」—— 这就是不能按克数算的理由
// 真值:23.53 / 23.53 / 52.94 —— 蛋白和碳水小数部分一模一样(都是 .53),
// 那一点余数按「蛋白 → 碳水 → 脂肪」的顺序补,所以是 24 / 23 / 53
const equalGrams = N.energyShare({ proteinG: 25, carbG: 25, fatG: 25 });
eq('同样克数不等于同样占比(蛋白拿进位)', equalGrams.proteinG, 24);
eq('同样克数不等于同样占比(碳水小数并列,让位)', equalGrams.carbG, 23);
eq('同样克数不等于同样占比(脂肪)', equalGrams.fatG, 53);
// 补进位不能随便塞给最后一个:脂肪真值 52.94 该拿 53,蛋白碳水 23.53 只该有一个拿 24
ok('进位落在小数最大的段上(脂肪 52.94→53)', equalGrams.fatG === 53);
eq('三项合计正好 100', equalGrams.proteinG + equalGrams.carbG + equalGrams.fatG, 100);
// 收尾的那一项用减法:三项各自四舍五入会凑出 99 或 101
for (const m of [{ proteinG: 33, carbG: 100, fatG: 40 }, { proteinG: 7, carbG: 61, fatG: 13 }, { proteinG: 1, carbG: 1, fatG: 1 }, { proteinG: 999, carbG: 1, fatG: 1 }]) {
  const s = N.energyShare(m);
  eq(`合计恒为 100(${m.proteinG}/${m.carbG}/${m.fatG})`, s.proteinG + s.carbG + s.fatG, 100);
}
eq('全是 0 → null(没有分母)', N.energyShare({ proteinG: 0, carbG: 0, fatG: 0 }), null);
// 一口脂肪都没吃,余数不能塞给它 —— 那会在条子上凭空长出一段玫红色
const noFat = N.energyShare({ proteinG: 33, carbG: 34, fatG: 0 });
eq('没吃脂肪就是 0%,不接余数', noFat.fatG, 0);
eq('这一天的余数给了碳水(小数更大)', noFat.carbG, 51);
// 负数不该出现,真出现了也不能算出负占比
const weird = N.energyShare({ proteinG: -10, carbG: 100, fatG: 20 });
ok('负克数被当 0,占比不为负', weird.proteinG === 0 && weird.fatG >= 0, JSON.stringify(weird));

section('文案');
eq('克数那行', N.macroLine({ proteinG: 82.4, carbG: 210.6, fatG: 52 }), '蛋白 82g · 碳水 211g · 脂肪 52g');
eq('占比那行', N.shareLine({ proteinG: 18, carbG: 52, fatG: 30 }), '蛋白 18% · 碳水 52% · 脂肪 30%');

section('蛋白差多少:够与不够');
const target = { proteinG: 105 };
eq('差 23 克', N.proteinShortBy({ proteinG: 82, carbG: 210, fatG: 52 }, target), 23);
eq('差 9 克不提(噪音)', N.proteinShortBy({ proteinG: 96, carbG: 210, fatG: 52 }, target), null);
eq('正好差 10 克说一句', N.proteinShortBy({ proteinG: 95, carbG: 210, fatG: 52 }, target), 10);
eq('达标了 → null', N.proteinShortBy({ proteinG: 130, carbG: 210, fatG: 52 }, target), null);
eq('超了也不会是负数', N.proteinShortBy({ proteinG: 200, carbG: 210, fatG: 52 }, target), null);
eq('没有目标 → null', N.proteinShortBy({ proteinG: 40, carbG: 210, fatG: 52 }, null), null);
eq('目标算不出来(0)→ null', N.proteinShortBy({ proteinG: 40, carbG: 210, fatG: 52 }, { proteinG: 0 }), null);
eq('本来就没记录 → null', N.proteinShortBy({ proteinG: 0, carbG: 210, fatG: 52 }, target), null);
eq('日均还没算出来 → null', N.proteinShortBy(null, target), null);

console.log(`\nsmoke: ${fail === 0 ? 'all passed' : `${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
