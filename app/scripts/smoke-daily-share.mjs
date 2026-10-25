/**
 * 每日分享卡 冒烟测试 —— 判定引擎阈值/标题优先级 + 金句兜底的轮换契约 + 排版折行/缩号 + 假 ctx 跑绘制。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-daily-share.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: {}, getStorageSync: () => '' };
  return origLoad.call(this, req, ...rest);
};

const V = require('../.smoke/engine/dailyVerdict.js');
const Q = require('../.smoke/constants/dailyQuotes.js');
const C = require('../.smoke/pkg-exercise/engine/daily-card.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/* 假 ctx:记下每一次绘制,measureText 按字数×宽模拟 */
function fakeCtx(charWidth = 13) {
  const calls = [];
  let fillStyle = '';
  return {
    calls,
    get fillStyle() { return fillStyle; },
    set fillStyle(v) { fillStyle = v; },
    strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (x, y) => calls.push(['moveTo', x, y]),
    lineTo: (x, y) => calls.push(['lineTo', x, y]),
    arc: (x, y, r) => calls.push(['arc', x, y, r]),
    closePath: () => calls.push(['closePath']),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
    fillRect: (x, y, w, h) => calls.push(['fillRect', x, y, w, h]),
    fillText: (t, x, y) => calls.push(['fillText', t, x, y, fillStyle]),
    measureText: (t) => ({ width: String(t).length * charWidth }),
    drawImage: (img, dx, dy, dw, dh) => calls.push(['drawImage', img, dx, dy, dw, dh])
  };
}
const textsOf = (ctx) => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);

/** 一份能到处用的输入底稿 */
const base = {
  intakeCalories: 1800, kcalTarget: 2000,
  proteinG: 110, proteinTargetG: 120,
  steps: 8000, stepGoal: 8000,
  training: null
};
const verdict = (over = {}) => V.dailyVerdict({ ...base, ...over });
const kcalRow = (over = {}) => verdict(over).rows.find((r) => r.key === 'kcal');
const proteinRow = (over = {}) => verdict(over).rows.find((r) => r.key === 'protein');

/* ============ 判定引擎 ============ */

section('热量阈值(85%~110% 达标,70%/125% 是 warn|bad 的分界)');
// 界上算达标、界下才降级 —— 边界值本身永远落在「更好」的那一档
ok('85% 整 = 达标', kcalRow({ intakeCalories: 1700 }).status === 'ok');
ok('84.95% = 略偏', kcalRow({ intakeCalories: 1699 }).status === 'warn');
ok('70% 整 = 略偏(吃得少但没到缺口)', kcalRow({ intakeCalories: 1400 }).status === 'warn');
ok('69.95% = 缺口大', kcalRow({ intakeCalories: 1399 }).status === 'bad');
ok('110% 整 = 达标', kcalRow({ intakeCalories: 2200 }).status === 'ok');
ok('110.05% = 略偏', kcalRow({ intakeCalories: 2201 }).status === 'warn');
ok('125% 整 = 略偏', kcalRow({ intakeCalories: 2500 }).status === 'warn');
ok('125.05% = 超了', kcalRow({ intakeCalories: 2501 }).status === 'bad');

section('蛋白质阈值(≥100% 达标,70% 是 warn|bad 的分界)');
ok('100% 整 = 达标', proteinRow({ proteinG: 120 }).status === 'ok');
ok('99% = 略缺', proteinRow({ proteinG: 119 }).status === 'warn');
ok('70% 整 = 略缺', proteinRow({ proteinG: 84 }).status === 'warn');
ok('69.9% = 缺口大', proteinRow({ proteinG: 83 }).status === 'bad');

section('大字标题:一天只讲最大的那个故事(缺口优先)');
ok('什么都没记 = 身体在等答案', verdict({ intakeCalories: 0, proteinG: 0, training: null }).headline === '今天,身体在等答案');
ok('热量缺口大 + 蛋白质也差 = 先说热量', verdict({ intakeCalories: 2600, proteinG: 60 }).headline === '今天,热量超了');
ok('只吃太少 = 说吃得太少(不是「及格」)', verdict({ intakeCalories: 1200 }).headline === '今天,吃得太少了');
ok('热量没问题、蛋白质缺口大 = 蛋白质上标题', verdict({ intakeCalories: 1800, proteinG: 70 }).headline === '今天,蛋白质拖了后腿');
ok('热量略偏压过蛋白质略缺', verdict({ intakeCalories: 2500, proteinG: 90 }).headline === '今天,热量多了一点');
ok('两侧都只差一口 = 还是先说热量(同一档里热量排前面)', verdict({ intakeCalories: 1600, proteinG: 90 }).headline === '今天,吃得少了点');
ok('记了但没填资料 = 记下来了', verdict({ kcalTarget: 0, proteinTargetG: 0 }).headline === '今天,记下来了 ✓');
ok('热量侧没得比(记了蛋白没记热量) = 记下来了', verdict({ intakeCalories: 0, proteinTargetG: 0, kcalTarget: 2000, proteinG: 100 }).headline === '今天,记下来了 ✓');
ok('全达标 = 及格', verdict({ intakeCalories: 2000, proteinG: 120 }).headline === '今天,身体及格了 ✓');

section('及格的判定(热量达标 且 蛋白质 ≥70%)');
ok('热量达标 + 蛋白质 75% = 及格(标题仍讲蛋白质,判定不降级)', (() => {
  const v = verdict({ intakeCalories: 1800, proteinG: 90 });
  return v.headline === '今天,蛋白质差一口' && v.pass === true;
})());
ok('热量略偏 = 不及格,哪怕蛋白质满格', verdict({ intakeCalories: 1600, proteinG: 130 }).pass === false);
ok('热量侧没得比 = 记下来了,不是「及格了」', verdict({ intakeCalories: 0, proteinTargetG: 0, kcalTarget: 2000, proteinG: 100 }).headline === '今天,记下来了 ✓');
ok('只记了训练也算「这一天不是空的」', verdict({ intakeCalories: 0, proteinG: 0, training: { title: '推', minutes: 40, sets: 12 } }).empty === false);

section('四行证据:一行一档,如实展示');
ok('热量主文案带目标', kcalRow().main === '1,800 / 2,000 大卡');
ok('蛋白质主文案带目标', proteinRow().main === '110 / 120 克');
ok('没目标时只报实数,不编分母', kcalRow({ kcalTarget: 0 }).main === '1,800 大卡');
ok('什么都没记就明说', kcalRow({ intakeCalories: 0, kcalTarget: 0 }).main === '还没有记录');
ok('训练行:练了什么 · 多少分钟', verdict({ training: { title: '推 · 胸肩三头', minutes: 62, sets: 14 } }).rows[2].main === '推 · 胸肩三头 · 62分钟');
ok('训练行:没练就说没练,不算扣分', verdict().rows[2].main === '今天没练' && verdict().rows[2].status === 'none');
ok('步数行:有步数报步数', verdict({ steps: 4300 }).rows[3].main === '4,300 步');
ok('步数行:没接入就明说', verdict({ steps: 0 }).rows[3].main === '未接入步数');
ok('进度条封顶 100%(超了不让条穿出轨道)', kcalRow({ intakeCalories: 2600 }).pct === 100);
ok('没目标的行不画条', kcalRow({ kcalTarget: 0 }).pct === null);
ok('步数过线=ok、六成以上=warn、更少只留轨道', (() => {
  const a = verdict({ steps: 8000 }).rows[3].status;
  const b = verdict({ steps: 5000 }).rows[3].status;
  const c = verdict({ steps: 1000 }).rows[3].status;
  return a === 'ok' && b === 'warn' && c === 'none';
})());

section('点评:每句话都跟着判定走');
ok('超了给的是「明天轻一点」,不是骂人', verdict({ intakeCalories: 2600 }).comment === '一天吃回来三天的量,明天轻一点就好');
ok('没记给的是路,不是空话', verdict({ intakeCalories: 0, proteinG: 0 }).comment === '记录只要一分钟,身体已经等了一整天');
ok('及格且练了 = 今天没白过', verdict({ proteinG: 120, training: { title: '推', minutes: 40, sets: 12 } }).comment === '吃动都在线,身体今天没白过');

/* ============ 金句兜底 ============ */

section('金句兜底:同一天全站同一句,轮换和服务端同一套公式(锚点 2026-01-01)');
ok('锚点当天 = 第 1 句', Q.pickFallbackQuote('2026-01-01').text === Q.FALLBACK_QUOTES[0].text);
ok('第二天 = 第 2 句', Q.pickFallbackQuote('2026-01-02').text === Q.FALLBACK_QUOTES[1].text);
ok('锚点前一天 = 最后一句(负数取模要兜住)', Q.pickFallbackQuote('2025-12-31').text === Q.FALLBACK_QUOTES[Q.FALLBACK_QUOTES.length - 1].text);
ok('同一天两次取到同一句', Q.pickFallbackQuote('2026-10-25').text === Q.pickFallbackQuote('2026-10-25').text);
ok('库里有 30 句(和常量名里的「每天换一句,一个月一轮回」对齐)', Q.FALLBACK_QUOTES.length === 30, `n=${Q.FALLBACK_QUOTES.length}`);
ok('30 句主句不重复', new Set(Q.FALLBACK_QUOTES.map((q) => q.text)).size === 30);
ok('首尾两句钉死,和服务端 DEFAULT_QUOTES 一致(改库必须两边一起改)', (() => {
  const first = '白天沙拉,深夜烧烤——身体都替你记着账呢';
  const last = '减脂不是苦行,是学会跟身体好好商量';
  return Q.FALLBACK_QUOTES[0].text === first && Q.FALLBACK_QUOTES[29].text === last;
})());
ok('每句都带副句(卡上金句下面那一行)', Q.FALLBACK_QUOTES.every((q) => q.sub && q.sub.length >= 2));

/* ============ 排版计算 ============ */

section('折行:超宽就换行,行数用完就收省略号');
{
  const ctx = fakeCtx(13);
  ok('放得下就不折', C.wrapLines(ctx, '短句', 620, 2).length === 1);
  const two = C.wrapLines(ctx, '一'.repeat(80), 620, 2);   // 每行 47 字
  ok('放不下折成两行', two.length === 2 && two.every((l) => l.length <= 47), two.map((l) => l.length).join('+'));
  const cut = C.wrapLines(fakeCtx(13), '一'.repeat(200), 620, 3);
  ok('三行封顶,末行带省略号', cut.length === 3 && cut[2].endsWith('…'));
  ok('空文本返回一行空串(别让 fillText 画 undefined)', C.wrapLines(fakeCtx(), '', 620, 2).join('') === '');
}

/** 字号感知的假 ctx:measureText 跟着 ctx.font 里的字号走(缩号测试要用) */
function scaledCtx(factor = 1) {
  const ctx = fakeCtx(13);
  ctx.measureText = (t) => ({
    width: String(t).length * (Number(/(\d+)px/.exec(ctx.font ?? '')?.[1] ?? 13)) * factor
  });
  return ctx;
}

section('大字标题缩号:56 起步,44 兜底');
ok('短标题保持 56', C.fitHeadlineSize(fakeCtx(13), '今天,身体及格了 ✓', 620) === 56);
ok('56 放不下先试 52,52 放得下就用 52', C.fitHeadlineSize(scaledCtx(1.15), '今天,身体及格了 ✓', 620) === 52);
ok('一路放不下就到 44 兜底', C.fitHeadlineSize(fakeCtx(70), '今天,身体及格了 ✓', 620) === 44);   // 假 ctx 宽度不随字号变 → 每档都放不下
ok('44 也放不下也就 44 了,不出负号', C.fitHeadlineSize(fakeCtx(200), '今天,热量超了', 620) === 44);

/* ============ 画一遍 ============ */

section('成绩单:画出来的字对不对');
{
  const ctx = fakeCtx();
  const v = V.dailyVerdict({ ...base, proteinG: 120, training: { title: '推 · 胸肩三头', minutes: 62, sets: 14 } });
  C.drawReport(ctx, { dateLabel: '10月25日 · 周日', verdict: v, recordDays: 12 }, {});
  const texts = textsOf(ctx);
  ok('眉题带上模板名和日期', texts.some((t) => t.includes('今日成绩单 · 10月25日 · 周日')));
  ok('大字标题上卡,半角逗号换成全角', texts.includes('今天，身体及格了'));
  ok('✓ 不走字符,画的是绿圆徽', ctx.calls.some((c) => c[0] === 'arc' && c[3] === 19) && ctx.calls.some((c) => c[0] === 'stroke'));
  ok('四行标签齐了', ['热量', '蛋白质', '训练', '运动'].every((k) => texts.includes(k)));
  ok('四行读数齐了', texts.includes('1,800 / 2,000 大卡') && texts.includes('120 / 120 克') && texts.includes('推 · 胸肩三头 · 62分钟') && texts.includes('8,000 步'));
  ok('点评上卡', texts.some((t) => t.includes('吃动都在线')));
  ok('坚持天数印记', texts.includes('已坚持记录 12 天'));
  ok('品牌页脚 + 扫码提示', texts.includes('轻身记') && texts.includes('记录，是改变的开始') && texts.includes('扫码进小程序'));
  ok('页脚条整幅不透明(把背景图右下角的水印盖掉)', ctx.calls.some((c) => c[0] === 'fillRect' && c[1] === 0 && c[2] === 1128 && c[3] === C.DAILY_W));
  ok('没拿到小程序码时画圆章,不让角落空着', ctx.calls.some((c) => c[0] === 'arc' && c[3] === 46) && texts.includes('轻'));
  ok('轨道条真的画了(roundRect 走 arc)', ctx.calls.filter((c) => c[0] === 'arc').length >= 8);
  ok('没有任何 NaN/undefined 上卡', !texts.some((t) => /NaN|undefined/.test(t)));
}
{
  const ctx = fakeCtx();
  const v = V.dailyVerdict({ intakeCalories: 0, kcalTarget: 0, proteinG: 0, proteinTargetG: 0, steps: 0, stepGoal: 0, training: null });
  C.drawReport(ctx, { dateLabel: '10月25日 · 周日', verdict: v, recordDays: 0 }, {});
  const texts = textsOf(ctx);
  ok('空日子也出得了卡:等答案 + 两句实话', texts.includes('今天，身体在等答案') && texts.includes('还没有记录') && texts.includes('今天没练'));
  ok('recordDays=0 不画印记', !texts.some((t) => t.includes('坚持记录')));
}
{
  const ctx = fakeCtx();
  C.drawReport(ctx, { dateLabel: 'x', verdict: verdict(), recordDays: 1 }, { bg: 'BG', qr: 'QR' });
  ok('背景整幅铺满', ctx.calls.some((c) => c[0] === 'drawImage' && c[1] === 'BG' && c[4] === C.DAILY_W && c[5] === C.DAILY_H));
  ok('有码就贴码(124 宽),圆章不出场', ctx.calls.some((c) => c[0] === 'drawImage' && c[1] === 'QR' && c[4] === 124) && !ctx.calls.some((c) => c[0] === 'arc' && c[3] === 46));
  ok('无背景时铺纸色兜底,不透明底也能出卡', (() => {
    const c2 = fakeCtx();
    C.drawQuote(c2, { dateLabel: 'x', quote: { text: '短句', sub: '一句副句' }, recordDays: 0 }, {});
    return c2.calls.some((x) => x[0] === 'fillRect' && x[3] === C.DAILY_W);
  })());
}

section('金句卡:画出来的字对不对');
{
  const ctx = fakeCtx(13);
  C.drawQuote(ctx, { dateLabel: '10月25日 · 周日', quote: { text: '白天沙拉,深夜烧烤——身体都替你记着账呢', sub: '看得见的摄入,才管得住' }, recordDays: 12 }, {});
  const texts = textsOf(ctx);
  ok('金句原文上卡(这句一行放得下,逗号换全角)', texts.includes('白天沙拉，深夜烧烤——身体都替你记着账呢'));
  ok('副句跟着', texts.includes('看得见的摄入，才管得住'));
  ok('页脚和印记同成绩单', texts.includes('轻身记') && texts.includes('已坚持记录 12 天'));
  ok('装饰引号上了卡', texts.includes('「'));
}
{
  const ctx = fakeCtx(30);   // 每字 30px → 544 宽一行只放 18 字,长句必折
  const quoteText = '不开心就吃,吃完更不开心,这笔账怎么算都不划算';
  C.drawQuote(ctx, { dateLabel: 'x', quote: { text: quoteText, sub: '短副句' }, recordDays: 0 }, {});
  ok('长金句折行后每一行都塞得进卡宽', (() => {
    const zhText = quoteText.replace(/,/g, '，');
    const lines = textsOf(ctx).filter((t) => t !== zhText && zhText.includes(t));
    return lines.length >= 2 && lines.every((l) => l.length * 30 <= C.TEXT_W);
  })());
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
