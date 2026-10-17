/**
 * ⑧ 计划分享 冒烟测试 —— 计划 ⇄ 一段文字。
 *
 * openGym 的 `lib/plan-share.js` 是把计划导成一个 JSON 文件(它是个网站,能下载文件);
 * 小程序**发不出文件**给微信好友,用户的出口只有剪贴板 —— 所以「发给朋友」「换计划前
 * 存一份自己的」「教练发来的计划」这三件事,在这里收口成同一段文字。它得同时满足:
 *   ①**处方逐字回来** —— 组数、次数(含每侧)、重量、休息、渐进、组型、超级组、
 *     末组尽力。少一样,用户导回来练的就是另一套处方,而且**不报错**;
 *   ②**每一格和别处一个念法** —— 次数走 sideRangeText、重量走 loadText、
 *     休息走 fmtDuration(1:30 而不是 90s)。另拼一套的话,同一份计划在计划页
 *     和这段文字里长得不一样,用户会以为哪里算错了;
 *   ③**认不出来就说不认** —— 手写的计划没有编号,重名/歧义的动作不猜
 *     (「卧推」能配出 44 个变式),整行列出来让人改,而不是悄悄换一个。
 *
 * 和「原样回来」有关的几个边界(模式重算、key 重发、周期回第 1 周)也在下面钉住:
 * 它们是**机器字段**,不是处方 —— 写清楚了才敢说「处方原样回来」。
 *
 * 用例里的计划项一律用 `generator.buildItem` 造(和生成器同一个入口),
 * 免得手搓出一份「自重动作却带着 2.5kg 递增」这种现实里不存在的计划,
 * 再去测它能不能原样回来。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-plan-text.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: {}, getStorageSync: () => '' };
  return origLoad.call(this, req, ...rest);
};

const E = '../.smoke/pkg-exercise/engine/';
const PT = require(`${E}plan-text.js`);
const G = require(`${E}generator.js`);
const L = require(`${E}load.js`);
const S = require(`${E}sided.js`);
const T = require(`${E}types.js`);
const P = require(`${E}patterns.js`);
const DUR = require('../.smoke/utils/duration.js');
const EX = require('../.smoke/pkg-exercise/data/exercises.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const eq = (name, got, want) => ok(name, got === want, got === want ? '' : `got ${JSON.stringify(got)} / want ${JSON.stringify(want)}`);
const section = (t) => console.log(`\n--- ${t} ---`);

/* 用例里用到的真实动作(全部来自 1,324 条动作库) */
const BENCH = '0025';   // barbell bench press — 杠铃卧推(负重)
const PULLUP = '0652';  // pull-up — 引体向上(自重)
const ROW = '0293';     // dumbbell bent over row — 哑铃俯身划船(哑铃,双侧)
const SIDED = '0006';   // alternate heel touchers — 交替脚跟触地卷腹(单侧动作)
const SQUAT = '0043';   // barbell full squat — 杠铃深蹲(全蹲),中文名带括号限定

const exOf = (id) => EX.EXERCISES.find((e) => e.id === id);
/** 一个计划项 —— 走生成器同一套规则造,只覆盖用例关心的那几格 */
const item = (id, pid, over = {}) => ({ ...G.buildItem(pid, exOf(id), 'muscle', 'beginner'), ...over });
const day = (key, title, items, over = {}) => ({ key, title, focus: '胸 + 肩', estMin: 40, items, ...over });

/** 一份最小可用的计划:两天的动作合起来覆盖 组数/次数/每侧/重量/休息/渐进/组型/末组尽力 */
const plan = (over = {}) => ({
  id: 'plan-1', createdAt: '2026-10-01T00:00:00.000Z',
  goal: 'muscle', level: 'beginner', access: 'gym',
  daysPerWeek: 2, sessionMin: 45, doneCount: 7, lastNote: '上次那条提示',
  days: [
    day('push-a', '推日 A', [
      item(BENCH, 'hpush', { sets: 4, weightKg: 60 }),
      item(PULLUP, 'vpull', { restSec: 60 })
    ]),
    day('legs-a', '腿日 A', [
      item(SIDED, 'core', { restSec: 0 }),                       // 超级组之间不休息那种 0
      item(ROW, 'hpull', { sets: 4, weightKg: 20, setType: 'drop', amrapLast: true })
    ])
  ],
  ...over
});

/* ===================== ① 写出去的文字长什么样 ===================== */
section('写出去的文字长什么样');

const text = PT.planToText(plan());
const rows = text.split('\n');
eq('第一行是文件头(带版本号)', rows[0], 'BODYOS-计划-1');
eq('第二行是配置行', rows[1], '增肌强壮 · 新手入门 · 健身房 · 每周 2 天 · 单堂 45 分钟');
eq('配置行后空一行', rows[2], '');
eq('第 1 天先是标题行(日名 + 重点)', rows[3], '第 1 天 推日 A · 胸 + 肩');
eq('动作行:序号 名字 (编号) · 组次 · 重量 · 休息 · 渐进', rows[4], `1 杠铃卧推 (${BENCH}) · 4 组 × 8-12 次 · 60kg · 休 1:30 · 线性加重`);
eq('自重动作写「自重」', rows[5], `2 引体向上 (${PULLUP}) · 3 组 × 8-12 次 · 自重 · 休 1:00 · 次数阶梯`);
eq('一天之间空一行', rows[6], '');
eq('第 2 天标题行', rows[7], '第 2 天 腿日 A · 胸 + 肩');
eq('单侧动作的次数折成每侧写在括号里', rows[8], `1 交替脚跟触地卷腹 (${SIDED}) · 3 组 × 24-40 次(每侧 12-20) · 自重 · 不休息 · 次数阶梯`);
eq('组型跟在渐进后面', rows[9].split(' · ')[5], '递减组');
eq('末组尽力写在组型后面', rows[9].split(' · ')[6], '末组尽力');
eq('末尾是注释行的用法说明', rows[rows.length - 1], '# 用 BodyOS 的「计划分享」粘进去就能导入');
eq('注释行前面留一个空行', rows[rows.length - 2], '');
eq('没有多余的空行(空行只用来分天、分文件头)', rows.filter((l) => l === '').length, 3);
ok('末尾没有换行(粘进输入框不会多一个空行)', !text.endsWith('\n'));
ok('不出现 undefined / NaN', !/undefined|NaN/.test(text));

// 每一格都走别处的口径 —— 这三条是「同一个事实只有一处措辞」的钉子
const cells = rows[4].split(' · ');
eq('次数那一格 === sideRangeText', cells[1], `4 组 × ${S.sideRangeText(8, 12, false)}`);
eq('重量那一格 === loadText', cells[2], L.loadText(BENCH, 60));
eq('休息那一格 === fmtDuration', cells[3], `休 ${DUR.fmtDuration(90)}`);
eq('渐进那一格 === PROGRESSION_ZH', cells[4], T.PROGRESSION_ZH.linear);
eq('自重那一格 === loadText(…, null)', rows[5].split(' · ')[2], L.loadText(PULLUP, null));
eq('每侧那一格 === sideRangeText(…, true)', rows[8].split(' · ')[1], `3 组 × ${S.sideRangeText(24, 40, true)}`);
ok('模式不出现在文字里(它是 BodyOS 自己的分类,不是处方)', !/hpush|vpull|模式/.test(text));

// 超级组:同一个组号且相邻才编号
const ssPlan = plan({
  days: [day('push-a', '推日 A', [
    item(BENCH, 'hpush', { superset: 'ss-a' }),
    item(ROW, 'hpull', { superset: 'ss-a' }),
    item(PULLUP, 'vpull')
  ])]
});
const ssRows = PT.planToText(ssPlan).split('\n').filter((l) => /^\d /.test(l));
ok('超级组成员各标一行「超级组 A」', ssRows[0].endsWith('· 超级组 A') && ssRows[1].endsWith('· 超级组 A'), ssRows[0]);
ok('落单的动作不标超级组', !ssRows[2].includes('超级组'), ssRows[2]);
ok('两个超级组按出现顺序编号 A / B', (() => {
  const two = PT.planToText(plan({
    days: [day('d', '推', [
      item(BENCH, 'hpush', { superset: 'ss-a' }), item(ROW, 'hpull', { superset: 'ss-a' }),
      item(PULLUP, 'vpull', { superset: 'ss-b' }), item(SIDED, 'core', { superset: 'ss-b' })
    ])]
  })).split('\n').filter((l) => l.includes('超级组')).map((l) => l.slice(-5));
  return two.join('|') === '超级组 A|超级组 A|超级组 B|超级组 B';
})());

/* ===================== ② 处方原样导得回来 ===================== */
section('处方原样导得回来');

const RX = ['exerciseId', 'sets', 'repsMin', 'repsMax', 'sided', 'weightKg', 'restSec', 'progression', 'setType', 'amrapLast', 'superset', 'weightStepKg', 'holdSec'];
const roundTrip = (p) => {
  const back = PT.parsePlanText(PT.planToText(p), { now: 0 });
  const a = p.days.flatMap((d) => d.items);
  const b = (back.plan?.days ?? []).flatMap((d) => d.items);
  const diffs = [];
  a.forEach((x, i) => {
    const y = b[i];
    if (!y) { diffs.push(`${i} ${x.nameZh} 丢了`); return; }
    for (const k of RX) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) diffs.push(`${i} ${x.nameZh} ${k}: ${JSON.stringify(x[k])} → ${JSON.stringify(y[k])}`);
  });
  return { back, diffs, count: a.length, got: b.length };
};

const mine = plan();
const rt = roundTrip(mine);
ok('动作一个不多一个不少', rt.got === rt.count, `${rt.got} / ${rt.count}`);
ok('每一项的处方逐字一样', rt.diffs.length === 0, rt.diffs.slice(0, 3).join(' ; '));
eq('没丢掉任何一行', rt.back.dropped.length, 0);
eq('没有没看懂的词', rt.back.notes.length, 0);
eq('天数一样', rt.back.days, 2);
eq('动作数一样', rt.back.items, 4);
eq('目标/水平/器械回来了', `${rt.back.plan.goal}|${rt.back.plan.level}|${rt.back.plan.access}`, 'muscle|beginner|gym');
eq('每周天数回来了', rt.back.plan.daysPerWeek, 2);
eq('单堂时长回来了', rt.back.plan.sessionMin, 45);
eq('单侧那项仍然记着每侧', rt.back.plan.days[1].items[0].sided, true);
eq('「不休息」回来还是 0 秒(不是默认值)', rt.back.plan.days[1].items[0].restSec, 0);
eq('自重回来还是自重(不是 0kg)', rt.back.plan.days[0].items[1].weightKg, null);
eq('组型回来了', rt.back.plan.days[1].items[1].setType, 'drop');
eq('末组尽力回来了', rt.back.plan.days[1].items[1].amrapLast, true);
eq('标题和重点都回来了', `${rt.back.plan.days[0].title}|${rt.back.plan.days[0].focus}`, '推日 A|胸 + 肩');

// 生成的计划(含单侧、有氧收尾,模式覆盖好几个)也得逐字回来
const gen = G.generatePlan({ goal: 'fatloss', level: 'beginner', access: 'gym', daysPerWeek: 3, sessionMin: 45 });
const genRt = roundTrip(gen);
ok('整份生成的计划处方逐字回来', genRt.diffs.length === 0, genRt.diffs.slice(0, 3).join(' ; '));
eq('生成的计划天数一样', genRt.back.days, gen.days.length);
eq('生成的计划动作数一样', genRt.back.items, gen.days.reduce((n, d) => n + d.items.length, 0));
eq('每天估时重算结果一致', genRt.back.plan.days.map((d) => d.estMin).join(','), gen.days.map((d) => d.estMin).join(','));
ok('导一遍再导一遍,文字一模一样', PT.planToText(genRt.back.plan) === PT.planToText(gen));

// 边界:机器字段(不是处方)在下面钉清楚,免得「原样回来」被读成「整个对象一样」
const back2 = PT.parsePlanText(PT.planToText(mine), { now: 0 }).plan;
ok('day key 一律重发(别人的 key 不进来)', back2.days.every((d) => /^imp-\d+$/.test(d.key)), back2.days.map((d) => d.key).join(','));
ok('原来的 key 不会出现在新计划里', !back2.days.some((d) => d.key === 'push-a' || d.key === 'legs-a'));
ok('plan id / createdAt 是新发的', back2.id !== mine.id && back2.createdAt !== mine.createdAt, back2.id);
eq('完成的次数不跟着别人走', back2.doneCount, 0);
eq('导入的计划给了摸重量那句提示', back2.lastNote, G.START_NOTE);
eq('提示只有一处措辞(生成的计划和导入的计划同一句)', G.generatePlan({ goal: 'muscle', level: 'beginner', access: 'gym', daysPerWeek: 3, sessionMin: 45 }).lastNote, G.START_NOTE);
// 模式(动作分类)是唯一会变的格子:它由动作库现算,不跟着文字走 —— 存下来的计划里
// 「有氧收尾」这种槽位重算成「核心训练」是允许的(它只影响编辑器里那行小字和「换个动作」
// 的候选,不影响上面那些处方格子)。生成的那份计划里正好有几个这样的动作,
// 所以这条断言有真实的证据:模式不一样,处方照样逐字一样。
const genItems = gen.days.flatMap((d) => d.items);
const drift = genItems.filter((x, i) => x.patternId !== genRt.back.plan.days.flatMap((d) => d.items)[i].patternId);
ok('模式都是动作库认得的模式(重算出来也是合法的)', genItems.every((x) => Object.keys(P.PATTERNS).includes(x.patternId)));
ok('模式重算和处方逐字一样可以同时成立', genRt.diffs.length === 0, `这份计划里有 ${drift.length} 个动作的模式会被重算`);

/* ===================== ③ 计时项的处方 =====================
 * 计时项的 `repsMin/repsMax` 是 0(见 engine/generator.ts)。照次数念就会写出
 * 「3 组 × 0 次」,而 0 不是有效次数 —— 导入时那一行会被整行丢掉,
 * 用户看到的是「我自己的计划导入不了」。所以这一节盯两件事:写出去的是「保持 X 秒」,
 * 以及那句话原样读得回来。
 */
section('计时项:写的是「保持」,不是「0 次」');

const PLANK = '2135';  // 负重平板支撑 — 静力动作,库里的处方本来就是时长
const parseOneRaw = (line) => PT.parsePlanText(`第 1 天 腿\n${line}`, { now: 0 });
const parseOne = (line) => parseOneRaw(line).plan.days[0].items[0];
const timedDay = day('core-a', '核心日', [item(PLANK, 'core')], { focus: '核心' });
const timedText = PT.planToText(plan({ days: [timedDay] }));
const timedCells = timedText.split('\n').find((l) => /^\d /.test(l)).split(' · ');
eq('组次那一格写的是「保持 45-90 秒」(核心槽位走长档)', timedCells[1], '3 组 × 保持 45-90 秒');
ok('整份文字里不出现「0 次」', !/0 次/.test(timedText), timedText.split('\n')[4]);
eq('计时项留在计划里的次数确实是 0(所以「保持」那一格不是装饰)',
  `${timedDay.items[0].repsMin}-${timedDay.items[0].repsMax} | ${timedDay.items[0].holdSec.min}-${timedDay.items[0].holdSec.max}`,
  '0-0 | 45-90');

const timedRt = roundTrip(plan({ days: [timedDay, day('core-b', '核心日 B', [item(PLANK, 'core')])] }));
ok('计时项导得回来(整行不会因为「0 次」被丢掉)', timedRt.got === timedRt.count, `${timedRt.got} / ${timedRt.count}`);
ok('计时项逐字一样(含 holdSec)', timedRt.diffs.length === 0, timedRt.diffs.slice(0, 3).join(' ; '));
eq('没有一行被丢掉', timedRt.back.dropped.length, 0);
eq('没有没看懂的词', timedRt.back.notes.length, 0);

// 手写的形状也要认:「保持 60 秒」/「60 秒」/「保持 1 分-1 分 30 秒」
const holdOf = (cell) => parseOne(`1 负重平板支撑 · 3 组 × ${cell}`);
eq('「保持 60 秒」', JSON.stringify(holdOf('保持 60 秒').holdSec), '{"min":60,"max":60}');
eq('不带「保持」也认', JSON.stringify(holdOf('60 秒').holdSec), '{"min":60,"max":60}');
eq('两边各带单位的区间', JSON.stringify(holdOf('保持 1 分-1 分 30 秒').holdSec), '{"min":60,"max":90}');
eq('秒数只写在后半段的区间', JSON.stringify(holdOf('保持 30-45 秒').holdSec), '{"min":30,"max":45}');
eq('计时项的次数一律归 0(秒数不该顺带改出个次数来)', `${holdOf('保持 60 秒').repsMin}-${holdOf('保持 60 秒').repsMax}`, '0-0');
eq('顺序反了也读得正(45-30 当笔误,小的当下限)', JSON.stringify(holdOf('保持 45-30 秒').holdSec), '{"min":30,"max":45}');
eq('「每侧 30 秒」留不住单侧,就报给用户看,不悄悄吞',
  parseOneRaw('1 负重平板支撑 · 3 组 × 保持 每侧 30 秒').notes.length, 1);
eq('报了也照样把时长读进来', JSON.stringify(parseOne('1 负重平板支撑 · 3 组 × 保持 每侧 30 秒').holdSec), '{"min":30,"max":30}');

// 旧版导出过的「3 组 × 0 次」:不许静悄悄变成次数
const legacy = PT.parsePlanText(`第 1 天 核心\n1 负重平板支撑 (${PLANK}) · 3 组 × 0 次 · 自重 · 休 45 秒 · 双进阶`, { now: 0 });
eq('旧文本里那一行还是进不来(0 次不是次数,不许猜成 0 次处方)', legacy.plan, null);
ok('但给出的理由指向正确的写法', /计时动作请写成/.test(legacy.dropped[0]?.why ?? ''), legacy.dropped[0]?.why ?? '(没报)');

/* ===================== ④ 每侧的两种写法 ===================== */
section('每侧的两种写法');

const both = parseOne(`1 交替脚跟触地卷腹 · 3 组 × 24-40 次(每侧 12-20)`);   // 导出的形状
const perSide = parseOne(`1 交替脚跟触地卷腹 · 3 组 × 每侧 12-20 次`);        // 人手写最自然的形状
const plain = parseOne(`1 交替脚跟触地卷腹 · 3 组 × 12 次`);                 // 没提每侧
ok('合计在前的写法:存合计 24-40、标每侧', `${both.repsMin}-${both.repsMax}|${both.sided}`, '24-40|true');
ok('整格按每侧写的折算成合计 24-40、标每侧', `${perSide.repsMin}-${perSide.repsMax}|${perSide.sided}`, '24-40|true');
ok('括号里的每侧数字不会被再折一次(24-40 不会变成 48-80)', both.repsMax === 40);
ok('没写每侧就按写的数字算,不替人折半', `${plain.repsMin}-${plain.repsMax}|${plain.sided}`, '12-12|undefined');
ok('两种写法读出来是同一项', JSON.stringify({ ...both, patternId: '' }) === JSON.stringify({ ...perSide, patternId: '' }));
ok('再导出还是导出时那个形状', PT.planToText(PT.parsePlanText(`第 1 天 腿\n1 交替脚跟触地卷腹 · 3 组 × 每侧 12-20 次`, { now: 0 }).plan).includes('24-40 次(每侧 12-20)'));

/* ===================== ④ 超级组 ===================== */
section('超级组');

const ssText = [
  '第 1 天 推',
  '1 杠铃卧推 · 4 组 × 8 次 · 60kg · 休 1:30 · 线性加重 · 超级组 A',
  '2 哑铃俯身划船 · 4 组 × 12 次 · 20kg · 休 1:30 · 双渐进 · 超级组 A',
  '3 引体向上 · 3 组 × 8 次 · 自重 · 休 1:00 · 次数阶梯 · 超级组 B',
  '4 哑铃卧推 · 3 组 × 10 次 · 15kg · 休 1:00 · 双渐进 · 超级组 B'
].join('\n');
const ssBack = PT.parsePlanText(ssText, { now: 0 }).plan.days[0].items;
ok('A 组两项共用一个组号', ssBack[0].superset && ssBack[0].superset === ssBack[1].superset, ssBack[0].superset);
ok('B 组是另一个组号', ssBack[2].superset && ssBack[2].superset !== ssBack[0].superset, ssBack[2].superset);
ok('同组的两项组号一致', ssBack[3].superset === ssBack[2].superset);
ok('只写「超级组」不带字母 → 当 A 组', (() => {
  const two = PT.parsePlanText('第 1 天 推\n1 杠铃卧推 · 3 组 × 8 次 · 超级组\n2 引体向上 · 3 组 × 8 次 · 超级组', { now: 0 }).plan.days[0].items;
  return !!two[0].superset && two[0].superset === two[1].superset;
})());
const ssTwice = PT.planToText(PT.parsePlanText(ssText, { now: 0 }).plan);
eq('导一遍再导一遍,文字一样(重复粘贴不会越滚越歪)', PT.planToText(PT.parsePlanText(ssTwice, { now: 0 }).plan), ssTwice);
eq('超级组标签按新顺序重排 A/B', ssTwice.split('\n').filter((l) => l.includes('超级组')).map((l) => l.slice(-1)).join(''), 'AABB');

/* ===================== ⑤ 手写的计划(没有编号) ===================== */
section('手写的计划(没有编号)');

const hand = [
  '兄弟,这是我最近在用的计划,你看看',
  '减脂塑形 · 健身房 · 每周 4 天 · 单堂 60 分钟',
  '',
  '第 1 天 推 · 胸肩三头',
  '1 杠铃卧推 · 4 组 × 8-10 次 · 60kg · 休 1:30 · 线性加重',
  '2 交替脚跟触地卷腹 · 3 组 × 每侧 12-20 次 · 自重 · 不休息 · 次数阶梯',
  '3 引体向上 · 3 组 × 8 次 · 自重 · 休 2 分',
  '4 杠铃深蹲 · 5 组 × 5 次 · 100kg · 休 3 分',
  '5 哑铃俯身划船 · 3 组 × 12 次 · 记得慢放,最后一组找人保护',
  '',
  '第 2 天 拉',
  '1 barbell bench press · 3 组 × 10 次 · 40kg',
  '2 卧推 · 3 组 × 10 次',
  '3 不存在的动作 · 3 组 × 10 次',
  '4 杠铃卧推 (9999) · 3 组 × 10 次',
  '5 哑铃俯身划船 · 3 组',
  '6 器械推胸机 (c-abcd1234) · 3 组 × 10 次'
].join('\n');
const H = PT.parsePlanText(hand, { now: 0 });
const handRows = hand.split('\n');
const whyOf = (list, startsWith) => (list.find((d) => d.text.startsWith(startsWith)) ?? {}).why;

eq('认出来几天', H.days, 2);
eq('认出来几个动作', H.items, 7);
eq('配置行认出来了', `${H.plan.goal}|${H.plan.access}|${H.plan.daysPerWeek}|${H.plan.sessionMin}`, 'fatloss|gym|4|60');
eq('目标写了就不被 fallback 顶掉', PT.parsePlanText(hand, { now: 0, fallback: { goal: 'muscle', level: 'intermediate', access: 'home' } }).plan.goal, 'fatloss');
eq('没写的那几格走 fallback(页面传用户自己那份)', PT.parsePlanText(hand, { now: 0, fallback: { goal: 'muscle', level: 'intermediate', access: 'home' } }).plan.level, 'intermediate');
eq('中文名认得出', H.plan.days[0].items[0].exerciseId, BENCH);
eq('英文名也认得出(动作库本来就是英文名)', H.plan.days[1].items[0].exerciseId, BENCH);
eq('带括号限定的中文名去掉括号也认(杠铃深蹲 → 杠铃深蹲(全蹲))', H.plan.days[0].items[3].exerciseId, SQUAT);
eq('「休 2 分」读成 120 秒', H.plan.days[0].items[2].restSec, 120);
eq('「休 3 分」读成 180 秒', H.plan.days[0].items[3].restSec, 180);
eq('「每侧 12-20」折成合计 24-40 并标每侧', `${H.plan.days[0].items[1].repsMin}-${H.plan.days[0].items[1].repsMax}|${H.plan.days[0].items[1].sided}`, '24-40|true');
eq('「不休息」读成 0 秒', H.plan.days[0].items[1].restSec, 0);
eq('没写组次的那一行不进来(第 2 天剩下英文名和「编号认不出来」那两条)', H.plan.days[1].items.length, 2);
eq('编号认不出来时按名字认 —— 对方自己建的动作,建个同名再粘一次就认了', H.plan.days[1].items[1].exerciseId, BENCH);

eq('寒暄那一行被点出来(不是被当成配置悄悄读掉)', whyOf(H.dropped, '兄弟'), '这一行不在任何一天里(先写「第 1 天 …」)');
eq('「卧推」配得上几十个变式 → 不猜,报出来', whyOf(H.dropped, '2 卧推'), '认不出这个动作:「卧推」');
eq('查无此动作 → 报出来', whyOf(H.dropped, '3 不存在的动作'), '认不出这个动作:「不存在的动作」');
eq('名字和编号都认不出来 → 两个都报出来(人一眼知道缺的是哪个动作)',
  whyOf(H.dropped, '6 器械推胸机'), '认不出这个动作:「器械推胸机」(编号 c-abcd1234 不在你的动作库里)');
eq('没写组次 → 报出来并教一句怎么写', whyOf(H.dropped, '5 哑铃俯身划船'), '没写组次(照「3 组 × 10 次」写)');
eq('一共 5 行没读出来', H.dropped.length, 5);
ok('报出来的每一行都带行号(能对着原文改)', H.dropped.every((d) => d.line > 0 && d.text.length > 0));
eq('行号指向原文那一行', handRows[H.dropped[0].line - 1], H.dropped[0].text);
eq('行号从 1 开始数(不是数组下标)', handRows[H.dropped[1].line - 1], H.dropped[1].text);
eq('备注那样的词收进 notes,不丢整行处方', H.notes.length, 1);
eq('notes 也带行号、也指得回原文', handRows[H.notes[0].line - 1].startsWith('5 哑铃俯身划船'), true);
eq('备注词原样列出来给用户看', H.notes[0].text, '记得慢放,最后一组找人保护');
eq('有没看懂的词也照认出来的部分导入', H.plan.days[0].items[4].exerciseId, ROW);

const noteOnly = PT.parsePlanText('第 1 天 推\n1 杠铃卧推 · 3 组 × 8 次 · 记得慢放', { now: 0 });
eq('只有备注的一行:处方还在', noteOnly.plan.days[0].items.length, 1);
eq('只有备注的一行:报一句', noteOnly.notes.length, 1);
eq('只有备注的一行:不算丢掉', noteOnly.dropped.length, 0);

/* ===================== ⑥ 认不出来就说不认(理由) ===================== */
section('认不出来就说不认');

const reasonOf = (t, opts) => PT.parsePlanText(t, opts).reason;
const newer = 'BODYOS-计划-2\n第 1 天 推\n1 杠铃卧推 (0025) · 3 组 × 8 次';
eq('更新版本的文件拒收', reasonOf(newer), '这份计划是更新版本的 BodyOS 写的,升级一下再用');
eq('被拒收时不给出半份计划', PT.parsePlanText(newer).plan, null);
eq('空文本', reasonOf(''), '这段文字里没读出计划 —— 先粘一份从 BodyOS 复制出来的,或者照它的样子写');
eq('只有注释', reasonOf('# 今天不想练'), '这段文字里没读出计划 —— 先粘一份从 BodyOS 复制出来的,或者照它的样子写');
eq('只有配置行、没有一天(→ 提示少了「第 N 天」这样的行)', reasonOf('减脂塑形 · 每周 4 天'), '这段文字里没读出计划 —— 是不是少了「第 1 天 推 · 胸肩三头」这样的行?');
eq('有一天的标题但一个动作都没认出来(→ 少的是动作,不是标题)', reasonOf('第 1 天 推\n1 卧推 · 3 组 × 10 次'), '这段文字里没读出计划 —— 先粘一份从 BodyOS 复制出来的,或者照它的样子写');
eq('认不出来时 days/items 都是 0', `${PT.parsePlanText('').days}/${PT.parsePlanText('').items}`, '0/0');
eq('只有一行分隔符的行不算动作', PT.parsePlanText('第 1 天 推\n·').dropped[0].why, '这一行里没有动作(只有分隔符)');
eq('空一天的标题不会变成空的一天(第 2 天没读出东西就不进来)', PT.parsePlanText('第 1 天 推\n1 杠铃卧推 · 3 组 × 8 次\n第 2 天 拉', { now: 0 }).plan.days.length, 1);
eq('一部分认不出来,剩下的照样能用', PT.parsePlanText('第 1 天 推\n1 杠铃卧推 · 3 组 × 8 次\n2 卧推 · 3 组 × 8 次', { now: 0 }).items, 1);
eq('认不出来的记在 dropped 里', PT.parsePlanText('第 1 天 推\n1 杠铃卧推 · 3 组 × 8 次\n2 卧推 · 3 组 × 8 次', { now: 0 }).dropped.length, 1);

/* ===================== ⑦ 配置行 ===================== */
section('配置行');

const cfg = (line, fb) => PT.parsePlanText(`${line}\n第 1 天 推\n1 杠铃卧推 · 3 组 × 8 次`, { now: 0, fallback: fb }).plan;
const c1 = cfg('增肌强壮 · 有一定经验 · 有哑铃 · 每周 6 天 · 单堂 90 分钟');
eq('五个格子都认', `${c1.goal}|${c1.level}|${c1.access}|${c1.daysPerWeek}|${c1.sessionMin}`, 'muscle|intermediate|dumbbell|6|90');
const c2 = cfg('有哑铃', { goal: 'fatloss', level: 'beginner', access: 'gym' });
eq('只写器械 → 其余照 fallback', `${c2.goal}|${c2.level}|${c2.access}`, 'fatloss|beginner|dumbbell');
eq('没写配置行时每周天数按认出来的天算', PT.parsePlanText('第 1 天 推\n1 杠铃卧推 · 3 组 × 8 次', { now: 0 }).plan.daysPerWeek, 1);
eq('每周天数超出范围时收在 1-7', cfg('减脂塑形 · 每周 99 天').daysPerWeek, 7);
eq('单堂时长超出范围时收在 10-180', cfg('减脂塑形 · 单堂 5 分钟').sessionMin, 10);
eq('每周 0 天也收在 1', cfg('减脂塑形 · 每周 0 天').daysPerWeek, 1);
ok('配置行的顺序可以乱(格与格之间用 · 分开就行)', cfg('健身房 · 减脂塑形 · 每周 3 天').goal === 'fatloss');

const cyc = PT.planToText(plan({ cycle: { style: '531', week: 3 } })).split('\n')[1];
ok('周期写进配置行', cyc.endsWith('· 周期 5/3/1 波次'), cyc);
const cycBack = PT.parsePlanText(PT.planToText(plan({ cycle: { style: '531', week: 3 } })), { now: 0 }).plan.cycle;
eq('周期样式跟着走', cycBack.style, '531');
eq('周期周次回到第 1 周(你没陪他走过前三周)', cycBack.week, 1);
eq('没写周期就不给周期', PT.parsePlanText(PT.planToText(plan()), { now: 0 }).plan.cycle, undefined);
eq('认不出的周期样式当没写', cfg('减脂塑形 · 周期 随便练练').cycle, undefined);

/* ===================== ⑧ 加进我的计划(不撞车) ===================== */
section('加进我的计划(不撞车)');

const cur = plan({ days: [day('imp-1', '上次导进来的', [item(BENCH, 'hpush')]), day('imp-2', '还有一天', [item(ROW, 'hpull')])] });
const imported = PT.parsePlanText(PT.planToText(plan()), { now: 0 }).plan.days;
const merged = PT.addImportedDays(cur, imported);
eq('原来那几天一个不少、一个字不改', merged.days.slice(0, 2).map((d) => `${d.key}|${d.title}`).join(','), 'imp-1|上次导进来的,imp-2|还有一天');
ok('原来那些天的对象原样带过来(不是重建的)', merged.days[0] === cur.days[0] && merged.days[1] === cur.days[1]);
eq('新加的天数目对', merged.days.length, 4);
eq('新加的天不会和上次导入的 imp-1 / imp-2 撞 key', merged.days.map((d) => d.key).join(','), 'imp-1,imp-2,imp-1-2,imp-2-2');
eq('key 全都唯一(「照这次再来一遍」要按键找当天)', new Set(merged.days.map((d) => d.key)).size, 4);
eq('每周天数加上了新练的那几天', merged.daysPerWeek, 4);
eq('每周天数封顶 7', PT.addImportedDays(plan({ daysPerWeek: 7 }), imported).daysPerWeek, 7);
eq('加的时候不动目标/水平/器械', `${merged.goal}|${merged.level}|${merged.access}`, 'muscle|beginner|gym');
eq('加的时候留着原来的完成次数', merged.doneCount, cur.doneCount);

/* ===================== ⑨ 可以直接发出去 ===================== */
section('可以直接发出去');

ok('没有网址 / 路径 / 文件名', !/https?:|\/pages\/|dist\/|\.json|\.zip/.test(text));
ok('没有内部话说给用户听(那几句是审核红线)', !/AI|智能|大模型|智谱/.test(text));
ok('没人看懂的字段名漏出来(planId/dayKey/exerciseId)', !/planId|dayKey|exerciseId|patternId/.test(text));
ok('一行不会太长(微信里不至于折得乱七八糟)', PT.planToText(gen).split('\n').every((l) => l.length <= 120), (() => {
  const longest = PT.planToText(gen).split('\n').sort((a, b) => b.length - a.length)[0];
  return `最长 ${longest.length}`;
})());
ok('动作编号是短号(不是内部 id)', PT.planToText(gen).split('\n').every((l) => !/\(plan-|\(wo-/.test(l)));
ok('认不出动作时列的是原文,不是内部编号', (() => {
  const d = PT.parsePlanText('第 1 天 推\n1 说不清的动作名 · 3 组 × 8 次', { now: 0 }).dropped[0];
  return d.why.includes('说不清的动作名') && !/undefined/.test(d.why);
})());

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
