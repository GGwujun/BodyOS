/**
 * 动作库搜索冒烟测试 —— 拿着**真数据**问几个真问题。
 *
 * 这套为什么要单独存在:搜索的毛病靠手点是发现不了的。试的人会去搜他记得名字的那个
 * 动作,一搜就有;而真正不知道动作叫什么的人(新手)一上手就是 0 结果,然后关掉 App。
 * 「搜『胸』搜不出卧推」这种话,只有拿数据跑一遍才说得出口。
 *
 * 钉住四组:
 *   1. **想练的地方 / 有的器械 / 动作名** 都要搜得到 —— 三个入口,不是三个功能;
 *   2. **逐词命中**:多个词是「都」不是「或」,顺序不管;
 *   3. **口语/简写表**:表里的每个词今天都搜得到,且指到的是库里真有的那批;
 *   4. **差一个字的兜底**:只该在 0 结果时出场,给的得是同一个动作家族,而且不接垃圾。
 *
 * 另有两条数据卫生:译表漏 key 会在搜索词里漏出 'undefined';空词是「没在搜」。
 *
 * 用法:`npm run smoke` 或 `node scripts/smoke-library-search.mjs`(要先编译,见 smoke.mjs)。
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { matchesQuery, nearMatches, searchWords } = require('../.smoke/pkg-exercise/engine/search.js');
const { EXERCISES } = require('../.smoke/pkg-exercise/data/exercises.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);
const hit = (q) => EXERCISES.filter((e) => matchesQuery(e, q));
const hasName = (q, word) => hit(q).some((e) => e.nameZh.includes(word));
const ids = (q) => new Set(hit(q).map((e) => e.id));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

section('数据集本身');
ok('动作库读得到', EXERCISES.length > 1000, `${EXERCISES.length} 条`);
ok('每条都有中文名', EXERCISES.every((e) => e.nameZh && e.name));
ok('每条都搜得动、且没有条目漏出 undefined/null 字样(译表漏 key 的信号)',
  EXERCISES.every((e) => {
    const w = searchWords(e).join(' ');
    return w.length > 0 && !/undefined|null/.test(w);
  }));

section('想练的地方 —— 「胸」「腿」这类词是新手最先打进去的');
ok('搜「胸」有结果', hit('胸').length > 0, `${hit('胸').length} 条`);
ok('搜「胸」搜得出卧推', hasName('胸', '卧推'));
ok('搜「胸」也搜得出俯卧撑(靠的是肌群/部位,不是名字)', hasName('胸', '俯卧撑'));
ok('搜「腿」有结果', hit('腿').length > 0, `${hit('腿').length} 条`);
ok('搜「腿」搜得出深蹲', hasName('腿', '深蹲'));
ok('搜「背」有结果', hit('背').length > 0, `${hit('背').length} 条`);

section('动作名 —— 搜自己人');
for (const w of ['卧推', '深蹲', '硬拉', '引体向上', '平板支撑']) {
  ok(`搜「${w}」搜得到它自己`, hit(w).some((e) => e.nameZh === w) || hasName(w, w), `${hit(w).length} 条`);
}
ok('按自己的名字搜,每条都该冒出来(抽样 50 条)', EXERCISES.slice(0, 50).every((e) => hit(e.nameZh).some((x) => x.id === e.id)));

section('有的器械 —— 「哑铃」这种词是他家里有什么,不是他要练哪儿');
ok('搜「哑铃」有结果', hit('哑铃').length > 20, `${hit('哑铃').length} 条`);
ok('搜「杠铃」有结果', hit('杠铃').length > 20, `${hit('杠铃').length} 条`);
ok('搜「弹力带」有结果', hit('弹力带').length > 0, `${hit('弹力带').length} 条`);

section('英文照样搜得到 —— 同一个框,两种人');
ok('搜 chest 有结果', hit('chest').length > 0, `${hit('chest').length} 条`);
ok('搜 chest 和搜「胸」差不多是一回事', Math.abs(hit('chest').length - hit('胸').length) < hit('胸').length * 0.5);
ok('大小写不影响', hit('BENCH').length === hit('bench').length && hit('bench').length > 0, `${hit('bench').length} 条`);
ok('搜 barbell 也有结果', hit('barbell').length > 20, `${hit('barbell').length} 条`);

section('英文只按词首 —— 中段撞上字母不算命中');
/* 起因是三条真数据里的假命中:'machine' 里有 'chin'(198 条器械题)、'narrow' 里有 'row'(9 条)、
   'warm up' 里有 'arm'。这些不是「像」,是字母碰巧挨着 —— 词首匹配把它们挡在外面 */
ok('搜 chin(引体的握法)不会把器械捞进来', hit('chin').length > 0 && hit('chin').every((e) => /chin/i.test(e.name)),
  `${hit('chin').length} 条`);
ok('搜 row(划船)不会把窄距捞进来', hit('row').length > 0 && hit('row').every((e) => /row/i.test(e.name)),
  `${hit('row').length} 条`);
ok('搜 arm 不会把热身捞进来', hit('arm').every((e) => !/warm/i.test(e.name)), `${hit('arm').length} 条`);
/* 中文反过来必须按任意位置:中文没有词边界,「背」出现在「下背部」里正是用户要的 */
ok('中文按中段照认(搜「背」搜得到引体向上,因为练的是背阔肌)', hasName('背', '引体向上'));

section('连字符两边都认 —— 「pull-up」和「pull up」是同一个动作');
const pullUp = ids('pull up');
const pulled = ids('pullup');
ok('搜「pull up」搜得到引体向上', hasName('pull up', '引体向上'), `${pullUp.size} 条`);
ok('搜「pullup」(连写)也搜得到', hasName('pullup', '引体向上'), `${pulled.size} 条`);
ok('两种写法给的是一批人', sameSet(pullUp, pulled), `${pullUp.size} vs ${pulled.size}`);
ok('库里的「pull-up」条目不含糊', hit('pull up').some((e) => /pull-up/i.test(e.name)));

section('多个词是「都」不是「或」');
const and = ids('哑铃 卧推');
ok('搜「哑铃 卧推」有结果', and.size > 0, `${and.size} 条`);
ok('每一条都同时有哑铃和卧推', hit('哑铃 卧推').every((e) => e.nameZh.includes('哑铃') && e.nameZh.includes('卧推')));
ok('比只搜「卧推」窄', and.size < hit('卧推').length, `${and.size} < ${hit('卧推').length}`);
ok('词序无所谓', sameSet(and, ids('卧推 哑铃')));
/* 中英混着打:一个词走口语表(db→哑铃),另一个词走原文字面(bench) */
const mixed = ids('db bench');
ok('中英混着打也行', mixed.size > 0 && hit('db bench').every((e) => e.nameZh.includes('哑铃')),
  `${mixed.size} 条`);

section('空词 = 没在搜(不是「搜了个空」)');
ok('空串命中全部', hit('').length === EXERCISES.length);
ok('一堆空格也是空', hit('   ').length === EXERCISES.length);
ok('只有换行/制表符也算空', hit('\t\n').length === EXERCISES.length);
ok('全是标点的查询不算「空」,算搜不到', hit('###').length === 0);

section('搜不到的东西就老老实实是 0');
ok('库里没有的词', hit('zzzzz').length === 0);
ok('半截拼不上的词也不该命中', hit('卧推压缩弹簧').length === 0);

section('协同肌群也算数(宁可多给几条让人自己挑)');
const withSecondary = EXERCISES.find((e) => Array.isArray(e.secondary) && e.secondary.length > 0);
ok('数据集里有带协同肌群的条目', !!withSecondary);
if (withSecondary) {
  const kw = searchWords(withSecondary).pop();
  ok('它的最后一组关键词能把它自己搜出来', !kw || hit(kw).some((x) => x.id === withSecondary.id), `搜「${kw}」`);
}

section('口语/简写表 —— 表里的每个词今天都搜得到');
/* 这份清单是**用户嘴里的话**,不是库里的词。左边每个今天都该有结果 ——
   哪天有人改了库或改了表把它们弄成 0,这条就红 */
const SPOKEN = ['胸肌', '背肌', '肩膀', '大臂', '小臂', '屁股', '后腰', '腿前侧', '腿后侧',
  '无器械', '绳子', '龙门架', 'db', 'bb', 'kb', 'bw', 'rdl', 'sldl', 'bp', 'ohp'];
for (const w of SPOKEN) ok(`搜「${w}」有结果`, hit(w).length > 0, `${hit(w).length} 条`);
/* 简写指到的那批,和它展开的原文/译名必须**一模一样** —— 不一样就说明表里的目标写歪了
   (真发生过:`bw` 指 'bodyweight' 只 14 条,库里的自重动作写的是 'body weight' 两个词) */
ok('「bw」= 搜「自重」那一批', sameSet(ids('bw'), ids('自重')), `${ids('bw').size} 条`);
ok('「无器械」= 搜「自重」那一批', sameSet(ids('无器械'), ids('自重')));
ok('「bb」= 搜「barbell」那一批', sameSet(ids('bb'), ids('barbell')), `${ids('bb').size} 条`);
ok('「db」= 搜「dumbbell」那一批', sameSet(ids('db'), ids('dumbbell')), `${ids('db').size} 条`);
ok('「kb」= 搜「kettlebell」那一批', sameSet(ids('kb'), ids('kettlebell')), `${ids('kb').size} 条`);
/* 剩下几个简写指的是一**类**动作(库里没有恰好叫这个的),所以钉的是「命中的都还在这一类里」:
   指歪了(比如 sldl 指到 romanian)就会混进别的动作,这条就红 */
ok('「sldl」命中的都是直腿那一类', hit('sldl').length > 0 && hit('sldl').every((e) => /直腿/.test(e.nameZh)),
  hit('sldl').map((e) => e.nameZh).join(' / '));
ok('「rdl」命中的都是罗马尼亚硬拉', hit('rdl').length > 0 && hit('rdl').every((e) => /罗马尼亚/.test(e.nameZh)),
  hit('rdl').map((e) => e.nameZh).join(' / '));
ok('「bp」命中的都是卧推', hit('bp').length > 0 && hit('bp').every((e) => /卧推/.test(e.nameZh)), `${hit('bp').length} 条`);
ok('「ohp」命中的都是过顶那一类', hit('ohp').length > 0 && hit('ohp').every((e) => /过头|推|颈后|肩/.test(e.nameZh)),
  `${hit('ohp').length} 条`);

section('差一个字的兜底 —— 只在 0 结果时才出场,给的得是同一个家族');
const near = (q) => nearMatches(EXERCISES, q);
ok('打错一个字母:sqaut(颠倒)接得上深蹲家族', near('sqaut').length > 0 && near('sqaut').every((e) => /蹲/.test(e.nameZh)),
  near('sqaut').map((e) => e.nameZh).join(' / '));
ok('打错一个字母:benchh 接得上卧推家族', near('benchh').length > 0 && near('benchh').every((e) => /卧推/.test(e.nameZh)),
  near('benchh').map((e) => e.nameZh).join(' / '));
ok('中文多打一个字:平板支掌 → 平板支撑', near('平板支掌').some((e) => e.nameZh.includes('平板支撑')));
ok('多词里混着错字也行:哑铃 sqaut → 哑铃深蹲', near('哑铃 sqaut').some((e) => e.nameZh === '哑铃深蹲'),
  near('哑铃 sqaut').map((e) => e.nameZh).join(' / '));
ok('短词不错容错(两字之差就是另一个部位了)', near('腹几').length === 0);
ok('垃圾不给兜底', near('zzzzz').length === 0);
ok('库外的东西也不硬指一个方向', near('卧推压缩弹簧').length === 0);
ok('最多三条', near('sqaut').length <= 3 && nearMatches(EXERCISES, 'sqaut', 1).length === 1);
/* 排序:整词差一个字的,要排在「长词里一截差一个字」的前面 —— 前者才是用户要找的那个本体。
   真数据上这条不好验(两个候选常常一样长),所以拿两条**造的**条目来问:
   「squatjump」只是词里有一截像(次之),「squat」整个词就是它(最像)。
   故意把次之那条的名字起短,这样不排序的话(按名字长短)它反而会排在前面 */
const frag = { id: 'zz-frag', nameZh: '半蹲跳', name: 'squatjump', target: '', bodyPart: '', equipment: '', category: '', secondary: [] };
const whole = { id: 'zz-whole', nameZh: '杠铃深蹲(窄站距)', name: 'squat', target: '', bodyPart: '', equipment: '', category: '', secondary: [] };
ok('整词对上的排在「一截对上」的前面',
  nearMatches([frag, whole], 'sqaut')[0].id === whole.id,
  nearMatches([frag, whole], 'sqaut').map((e) => e.nameZh).join(' / '));

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
