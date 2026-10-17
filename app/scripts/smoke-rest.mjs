/**
 * 组间休息计时的算术冒烟(`engine/rest.ts`)。
 *
 * 套件存在的理由:这里全是时间算术,而**时间算术的错不会报错**。
 * 少歇 40 秒、暂停完回来发现从零开始、进度条冲到 105% —— 每一样都不崩,只是「这表不准」,
 * 用户不会来报,我们也不会知道。所以把它从页面里搬出来,钉在这里。
 *
 * 盯五件事:
 *   1. **墙钟反算** —— 剩余只由「结束时刻 − 现在」决定,不自己数秒(切后台不丢时间);
 *   2. **暂停真的冻住** —— 暂停期间怎么等,剩余都不变(这正是这个功能的意义:
 *      「你站着等了五分钟,那是等器材不是休息」);
 *   3. **暂停中不算到点** —— 冻结后 `endsAt` 落在过去,判定忘了这一条的话,
 *      用户从后台回来会发现暂停被悄悄收掉了(页面 useDidShow 那一路踩的就是这个);
 *   4. **继续不多不少** —— 恢复后的剩余必须正好等于冻结时的剩余;
 *   5. **+15 秒与进度条** —— 加时间在暂停中也要算对(拿墙钟当基准会得到负剩余,条子塌到 0)。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-rest.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// rest.ts 是个叶子(不 import 任何东西),本来不需要桩;留着是为了和别的 engine 套件同形,
// 免得哪天它真的开始 import 别的东西时,这套用例静默地测不到自己以为在测的东西。
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

const R = require('../.smoke/pkg-exercise/engine/rest.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

// 一个固定的「现在」。全部用绝对毫秒数,读用例时能直接心算 —— 别用 Date.now(),
// 那会让「到底是哪一版算错了」这件事随着跑的时刻变来变去。
const T0 = 1_700_000_000_000;
const sec = (n) => n * 1000;
const at = (n) => T0 + sec(n);

/* ================= 起表 ================= */
section('起表');
const t90 = R.restStart(90, T0);
ok('90 秒 → endsAt 落在 90 秒后', t90.endsAt === at(90), String(t90.endsAt - T0));
ok('90 秒 → total 就是 90', t90.total === 90);
ok('刚起表时剩余 = total', R.restRemain(t90, T0) === 90);
ok('起表时不带 pausedAt(没在暂停)', t90.pausedAt == null);
ok('0 秒 → null(不休息就是没有这条)', R.restStart(0, T0) === null);
ok('负数 → 也是 null', R.restStart(-30, T0) === null);

/* ================= 墙钟反算 ================= */
section('墙钟反算:剩余只由「结束时刻 − 现在」决定');
ok('走 30 秒 → 剩 60', R.restRemain(t90, at(30)) === 60);
ok('走 89 秒 → 剩 1', R.restRemain(t90, at(89)) === 1);
ok('刚好到点 → 剩 0', R.restRemain(t90, at(90)) === 0);
ok('过点 10 分钟 → 还是 0(**不能是负数**)', R.restRemain(t90, at(690)) === 0);
// 小数秒向上取整:显示「1 秒」的那一下真的还有零点几秒,提前跳 0 会让人以为已经结束
ok('剩 0.4 秒 → 向上取整成 1', R.restRemain(t90, at(89.6)) === 1);
ok('剩 0.4 秒时还没到点', R.restOver(t90, at(89.6)) === false);
ok('到点时算到点', R.restOver(t90, at(90)) === true);
ok('过点算到点', R.restOver(t90, at(91)) === true);

/* ================= 暂停 ================= */
section('暂停:冻住,而且暂停期间怎么等都不变');
const paused = R.toggleRestPause(t90, at(20));
ok('暂停记下了那一刻', paused.pausedAt === at(20));
ok('暂停瞬间剩余 = 70(90 − 20)', R.restRemain(paused, at(20)) === 70);
ok('**等 5 分钟再看,还是 70**(等器材不算休息)', R.restRemain(paused, at(320)) === 70);
ok('等 2 小时也还是 70', R.restRemain(paused, at(7200)) === 70);
ok('暂停中没有「到点」这回事', R.restOver(paused, at(91)) === false);
ok('暂停中再过很久也不到点', R.restOver(paused, at(9999)) === false);
ok('暂停不改 total(进度条的分母不动)', paused.total === 90);
ok('暂停不改 endsAt(它只是被当成「冻结前的结束时刻」存着)', paused.endsAt === at(90));

/* ================= 继续 ================= */
section('继续:不多不少');
const resumed = R.toggleRestPause(paused, at(320));
ok('继续之后不再带 pausedAt', resumed.pausedAt == null);
ok('恢复后的剩余 = 冻结时的剩余(70)', R.restRemain(resumed, at(320)) === 70);
ok('新的结束时刻 = 继续那一刻 + 70 秒', resumed.endsAt === at(390), String(resumed.endsAt - T0));
ok('total 还是 90', resumed.total === 90);
ok('走到新的结束时刻才到点', R.restOver(resumed, at(389)) === false && R.restOver(resumed, at(390)) === true);
ok('与「暂停前 20 秒 + 恢复后 70 秒」相符',
  R.restRemain(resumed, at(320 + 35)) === 35);
// 往返多次不该漂:每按一下都拿「冻结的那一刻」重算,误差不会攒。
// (核对一下时刻:at(400) 继续 → 剩 70,本该 at(470) 到点;at(460) 又暂停 → 还剩 10;
//  at(900) 再继续 → 从这一刻往后数 10 秒。中间隔了 440 秒,一秒都不许少。)
const p1 = R.toggleRestPause(paused, at(400));
const p2 = R.toggleRestPause(p1, at(460));
const p3 = R.toggleRestPause(p2, at(900));
ok('往返一趟:剩 70', R.restRemain(p1, at(400)) === 70);
ok('歇到第 60 秒又暂停:剩 10', R.restRemain(p2, at(460)) === 10);
ok('隔了 440 秒才继续:仍是 10(不漂)', R.restRemain(p3, at(900)) === 10);
ok('两趟之后 total 也还是 90', p3.total === 90);
ok('…而且新的结束时刻正好是 at(910)', p3.endsAt === at(910));
// 暂停后再暂停没有意义 —— 且必须看得出来「已经是暂停了」,不能把 pausedAt 冲掉
const repause = R.toggleRestPause(paused, at(999));
ok('连按两下暂停 = 继续(第二下不会覆盖 pausedAt)',
  repause.pausedAt == null && R.restRemain(repause, at(999)) === 70);

/* ================= +15 秒 ================= */
section('+15 秒');
const ext = R.extendRest(t90, R.EXTEND_SEC, at(10));
ok('加 15 秒后剩余 95', R.restRemain(ext, at(10)) === 95);
ok('total 跟着抬到 95(进度条才不会超过 100%)', ext.total === 95);
ok('EXTEND_SEC 就是 15(页面文案「+15s」跟着它)', R.EXTEND_SEC === 15);
const ext2 = R.extendRest(ext, R.EXTEND_SEC, at(10));
ok('连加两次 → total 连抬两次', ext2.total === 110);
// 分母是「这一段休息曾经最长的那一次」,**不是**当下剩余 —— 所以只在剩余真的顶破老分母时才抬。
// 加时间在尾巴上(第 89 秒剩 1 秒时 +15)不该把条子刷回满格:人已经歇了 89 秒,
// 条子说「满格」等于说他又从零开始歇了。41% 才是实话。
const tail = R.extendRest(t90, R.EXTEND_SEC, at(89));
ok('剩 1 秒时 +15 → 剩 16 秒,但 total 保持 90(分母只涨不缩)', R.restRemain(tail, at(89)) === 16 && tail.total === 90);
ok('…所以条子是 18% 不是 100%(「你还在歇着的第 89 秒」)', Math.round(R.restPct(tail, at(89))) === 18);
ok('**任何写法下分母都不许小于剩余**(不然条子能超过 100%)',
  R.restRemain(tail, at(89)) <= tail.total);

section('+15 秒 **在暂停中**');
// 这一条是本套件最该守住的一条:扩展时如果拿 Date.now() 当剩余基准,
// 暂停中的 endsAt 早已落在过去,算出来是负数 —— 条子塌到 0,用户以为休息被清了
const extPaused = R.extendRest(paused, R.EXTEND_SEC, at(320));
ok('暂停中加 15 秒 → 剩余 70 + 15 = 85(不是 0)', R.restRemain(extPaused, at(320)) === 85);
ok('暂停中加 15 秒后依然不算到点', R.restOver(extPaused, at(9999)) === false);
ok('暂停中加时间:total 仍是 90(85 没顶破老分母,就不动)', extPaused.total === 90);
ok('接着继续 → 剩余正好 85', R.restRemain(R.toggleRestPause(extPaused, at(400)), at(400)) === 85);
ok('暂停中加时间不改变「冻结是哪一刻」', extPaused.pausedAt === at(20));
// 上面那条 85 没顶破老分母(90),所以**分不出**基准取的是 pausedAt 还是 Date.now() ——
// 两种写法都会走到 `max(90, …)` 的 90 那头。要看出区别,得让剩余长过老分母:
// 90 秒的表在第 20 秒暂停(剩 70),连加两次 → 剩 100 > 90,分母必须跟着长到 100。
// 拿 Date.now() 当基准的话,这里算出来是负数,分母卡在 90 —— 条子给出 90% 而实际剩 100 秒。
const big = R.extendRest(R.extendRest(paused, R.EXTEND_SEC, at(320)), R.EXTEND_SEC, at(320));
ok('暂停中连加两次 → 剩 100', R.restRemain(big, at(320)) === 100);
ok('…顶破老分母,所以 total 跟着长到 100(基准取的是冻结那一刻)', big.total === 100);
ok('…条子满格而不是 90%', R.restPct(big, at(320)) === 100);
ok('…继续之后仍是 100', R.restRemain(R.toggleRestPause(big, at(400)), at(400)) === 100);

/* ================= 进度条 ================= */
section('进度条');
ok('刚起表 → 100%', R.restPct(t90, T0) === 100);
ok('走一半 → 50%', R.restPct(t90, at(45)) === 50);
ok('过点 → 0%(不出现负数)', R.restPct(t90, at(900)) === 0);
ok('暂停中冻住 → 与暂停那一刻同宽', R.restPct(paused, at(20)) === R.restPct(paused, at(9999)));
// 那条 bug 的样子是条子塌到 0;正确结果是 85/90 ≈ 94%(差一点点就歇完了),不是 0 也不是满格
ok('暂停中加时间 → 94%,不是 0(塌 0 就是那条 bug 的样子)',
  Math.round(R.restPct(extPaused, at(320))) === 94, String(R.restPct(extPaused, at(320))));
ok('任何时刻都不超过 100%', [0, 10, 45, 89, 90, 91, 900].every((s) => R.restPct(t90, at(s)) <= 100));
ok('total 为 0 时给 0,不给 NaN',
  R.restPct({ endsAt: at(10), total: 0 }, T0) === 0);

/* ================= 一串真实一点的走法 ================= */
section('串起来:起表 → 暂停 → 加时间 → 继续 → 到点');
let s = R.restStart(120, T0);              // 歇 2 分钟
ok('① 走到第 40 秒,还剩 80', R.restRemain(s, at(40)) === 80);
s = R.toggleRestPause(s, at(40));          // 器材被占
ok('② 暂停,剩余冻在 80', R.restRemain(s, at(500)) === 80);
s = R.extendRest(s, R.EXTEND_SEC, at(500)); // 觉得还得再歇会儿
ok('③ 加 15 秒 → 95', R.restRemain(s, at(500)) === 95);
s = R.toggleRestPause(s, at(560));         // 器材空出来了
ok('④ 继续,剩余 95', R.restRemain(s, at(560)) === 95);
ok('⑤ 走到第 95 秒才到点', R.restOver(s, at(560 + 94)) === false && R.restOver(s, at(560 + 95)) === true);

console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
