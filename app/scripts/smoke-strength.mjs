/**
 * M10.3 力量保持 冒烟测试 —— 每个动作自己的成绩衰减。
 * 重点不是曲线公式(那几行谁看都懂),而是**口径**:
 * 哪些组算成绩、补录的算不算、自重动作怎么办、什么时候该闭嘴不说。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-strength.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* mock Taro:引擎模块(store/custom…)会 import 它,而真 Taro 在 Node 下起不来
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

const S = require('../.smoke/pkg-exercise/engine/strength.js');
const O = require('../.smoke/pkg-exercise/engine/onerm.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

/**
 * 造日志。sets 用 [重量, 次数] 简写,null 重量 = 自重。
 * 取 reps=1 时 estimate1RM 就是重量本身,便于把「保持率」和「公斤数」对上账。
 */
const log = (date, entries, extra = {}) => ({
  id: date + (extra.id ?? ''), planId: 'p1', dayKey: 'a', dayTitle: 'A', date,
  entries: entries.map(([id, sets, name]) => ({
    exerciseId: id, nameZh: name ?? id,
    sets: sets.map(([w, r]) => ({ weightKg: w, reps: r, rir: 2 }))
  })),
  ...extra
});

/* ================= 曲线 ================= */
section('衰减曲线');
ok('停练 ≤ 14 天一动不动', S.retainedAt(0) === 1 && S.retainedAt(7) === 1 && S.retainedAt(14) === 1);
ok('第 15 天开始掉(刚过平台期只掉一点点)', S.retainedAt(15) < 1 && S.retainedAt(15) > 0.97, String(S.retainedAt(15)));
ok('一个半衰期(14+28 天)正好剩一半', Math.abs(S.retainedAt(42) - 0.5) < 1e-9, String(S.retainedAt(42)));
ok('平台期中间(14+14 天)剩约 71%', Math.abs(S.retainedAt(28) - 0.7071) < 0.001, String(S.retainedAt(28)));
ok('最低压在 50%,继续停也不往下掉', S.retainedAt(100) === 0.5 && S.retainedAt(3650) === 0.5);
ok('天数读不懂/为负 → 当没掉(不猜用户退步了)', S.retainedAt(NaN) === 1 && S.retainedAt(-5) === 1);

/* ================= 哪些组算成绩 ================= */
section('哪些组算成绩');
const T = '2026-10-15';
{
  const one = S.strengthRows([log('2026-10-15', [['bp', [[100, 1]]]])], T);
  ok('一次训练就出得来一行', one.length === 1 && one[0].exerciseId === 'bp');
  ok('最好成绩就是估算出来的 1RM', Math.abs(one[0].bestE1rm - O.estimate1RM(100, 1)) < 0.001);
  ok('今天练过 → 保持 100%、掉 0kg', one[0].retained === 1 && one[0].restDays === 0 && one[0].lostKg === 0);
}
{
  // 100kg×1 和 90kg×8 —— 后者估算出来的 1RM 反而更高,取高的那个
  const r = S.strengthRows([log('2026-10-15', [['bp', [[100, 1], [90, 8]]]])], T)[0];
  const best = Math.max(O.estimate1RM(100, 1), O.estimate1RM(90, 8));
  ok('同一次里取估算值最高的那组', Math.abs(r.bestE1rm - best) < 0.001, String(r.bestE1rm));
}
{
  // 9/1 那次最好(120),但 9/1 也是最后一次练 —— 停练天数从最后那次算,不是从最好那次单独算
  const r = S.strengthRows([log('2026-09-01', [['bp', [[120, 1]]]]), log('2026-08-01', [['bp', [[100, 1]]]])], T);
  ok('跨多次取历史最好', Math.abs(r[0].bestE1rm - 120) < 0.001, String(r[0].bestE1rm));
  ok('停练天数从**最后一次**练算(9/1 → 10/15 = 44 天),不是从最好那次算', r[0].restDays === 44, String(r[0].restDays));
  ok('最好成绩是哪天做出来的也留着', r[0].bestDate === '2026-09-01');
}
{
  const r = S.strengthRows([log('2026-10-15', [['bp', [[100, 20]]]])], T);
  ok('超过 12 次的组不算成绩(外推的 1RM 是编的)', r.length === 0);
}
{
  const r = S.strengthRows([log('2026-10-15', [['pullup', [[null, 8]]]])], T);
  ok('自重动作不进这个列表(没有重量就没有成绩,不编一个数)', r.length === 0);
}
{
  const r = S.strengthRows([log('2026-10-15', [['bp', [[0, 8]]]])], T);
  ok('0kg 不算成绩', r.length === 0);
}

section('补录的日志:算「练过」但不算「成绩」');
{
  // 6 月那次是补录的(重量记不准),8 月那次是当场记的
  const logs = [
    log('2026-08-01', [['bp', [[100, 1]]]]),
    log('2026-06-01', [['bp', [[200, 1]]]], { manual: true })
  ];
  const r = S.strengthRows(logs, T)[0];
  ok('补录的重量不当成绩(200kg 那个不算数)', Math.abs(r.bestE1rm - 100) < 0.001, String(r.bestE1rm));
  ok('但补录那天算「练过」 —— 确实发生过,只是记晚了', r.lastDate === '2026-08-01');
}
{
  const logs = [log('2026-06-01', [['bp', [[100, 1]]]]), log('2026-10-01', [['bp', [[90, 1]]]], { manual: true })];
  const r = S.strengthRows(logs, T)[0];
  ok('补录把「上次练」推到更近 → 停练天数跟着变短', r.restDays === 14, String(r.restDays));
}

/* ================= 掉分与排序 ================= */
section('掉了的动作');
{
  const logs = [
    log('2026-08-01', [['bp', [[100, 1]]]]),     // 停 75 天 → 早过了平台期,压到 0.5 下限
    log('2026-10-05', [['sq', [[80, 1]]]])       // 停 10 天 → 一格没掉
  ];
  const rows = S.strengthRows(logs, T);
  ok('两行都在', rows.length === 2);
  const bp = rows.find((r) => r.exerciseId === 'bp');
  ok('停到下限的动作:预估成绩正好是历史最好的一半', bp.currentE1rm === 50 && bp.lostKg === 50, `${bp.currentE1rm}/${bp.lostKg}`);
  const faded = S.fadedRows(rows);
  ok('只留下真掉了的', faded.length === 1 && faded[0].exerciseId === 'bp');
  ok('预估成绩从高到低排(主项在前)', rows[0].exerciseId === 'sq', rows.map((r) => r.exerciseId).join());
}
{
  // 小重量动作刚过平台期:10kg 的最好成绩只掉了 0.2kg —— 真掉了,但界面上不值得提
  const r = S.strengthRows([log('2026-09-30', [['lateral', [[10, 1]]]])], T)[0];
  ok('确实过了平台期', r.restDays === 15 && r.retained < 1, `${r.restDays}/${r.retained}`);
  ok('但掉的绝对公斤数不到半公斤就不提(那是舍入误差,不是信息)', S.fadedRows([r]).length === 0, String(r.lostKg));
}
{
  const logs = [
    log('2026-07-01', [['a', [[100, 1]]]]),   // 掉 50
    log('2026-08-01', [['b', [[60, 1]]]])     // 掉 30
  ];
  const faded = S.fadedRows(S.strengthRows(logs, T));
  ok('掉得多的排前面', faded.map((r) => r.exerciseId).join() === 'a,b', faded.map((r) => r.exerciseId).join());
}

/* ================= 单查 ================= */
section('查一个动作');
{
  const logs = [log('2026-10-15', [['bp', [[100, 1]]]])];
  ok('查得到', S.strengthOf(logs, 'bp', T)?.exerciseId === 'bp');
  ok('没成绩的动作查到 null(不是编一行 0kg)', S.strengthOf(logs, 'zzz', T) === null);
}

/* ================= 人话 ================= */
section('说人话');
ok('今天/昨天有专门的说法', S.restText(0) === '今天练过' && S.restText(1) === '昨天练过');
ok('两周以内按天说', S.restText(3) === '停练 3 天' && S.restText(13) === '停练 13 天');
ok('两周以上按周说(14 天 = 2 周)', S.restText(14) === '停练 2 周' && S.restText(44) === '停练 6 周');
ok('两个月以上按月说', S.restText(60) === '停练 2 个月' && S.restText(200) === '停练 7 个月');
{
  const kept = S.strengthRows([log('2026-10-15', [['bp', [[100, 1]]]])], T)[0];
  const faded = S.strengthRows([log('2026-09-01', [['bp', [[100, 1]]]])], T)[0];   // 停 44 天 = 6 周
  ok('保持住了就说保持住了', S.keptText(kept) === '保持住了' && S.isFaded(kept) === false);
  ok('掉了就说掉了多少', S.isFaded(faded) === true && S.keptText(faded) === '停练 6 周,约剩 50%', S.keptText(faded));
  ok('保持率那句话带停练时长', S.retainedText(faded) === '停练 6 周 · 力量约剩 50%', S.retainedText(faded));
}

section('整个列表的一句话');
ok('一个都没掉就不说话(让调用方别渲染)', S.fadedVerdict(S.strengthRows([log('2026-10-15', [['bp', [[100, 1]]]])], T)) === null);
{
  const one = S.strengthRows([log('2026-08-01', [['bp', [[100, 1]]]])], T);
  const t1 = S.fadedVerdict(one);
  ok('只有一个掉的时候说「只有」', /^只有「bp」掉了/.test(t1), t1);
  const two = S.strengthRows([log('2026-08-01', [['bp', [[100, 1]]]]), log('2026-07-01', [['sq', [[80, 1]]]])], T);
  const t2 = S.fadedVerdict(two);
  ok('多个掉的时候给条数 + 最明显的那个', /^2 个动作/.test(t2) && /「bp」/.test(t2), t2);
}

/* ================= 脏数据 ================= */
section('脏数据不炸');
ok('空日志', S.strengthRows([]).length === 0 && S.fadedVerdict([]) === null);
ok('空/脏日志不炸', S.strengthRows([null, {}, { entries: null }, { date: 'x' }]).length === 0);
ok('缺 sets 的动作不炸', S.strengthRows([{ date: '2026-10-15', entries: [{ exerciseId: 'a' }] }]).length === 0);
ok('没有 nameZh 就用 id 顶上', S.strengthRows([{ date: '2026-10-15', entries: [{ exerciseId: 'a', sets: [{ weightKg: 50, reps: 1 }] }] }], T)[0].nameZh === 'a');

/* ================= 按部位归并(身体图「看力量」) =================
   真库 id:'0025' 杠铃卧推(胸主 + 手臂/肩协同)、'0308' 哑铃飞鸟(胸主 + 肩协同)、
   '0032' 杠铃硬拉(臀腿主 + 背协同;股绳肌同归臀腿,去重后不加权)。 */
section('按部位归并');
{
  // 卧推 100×1 今天练 → 胸保持 100%;手臂和肩是协同,也各记半份
  const gs = S.groupStrength(S.strengthRows([log(T, [['0025', [[100, 1]]]])], T));
  ok('胸:一行、保持 100%、今天大约还是 100', gs.chest.rows.length === 1
    && gs.chest.retained === 1 && gs.chest.topE1rm === 100);
  ok('协同肌也出现(卧推记半份手臂、半份肩)', gs.arm.rows.length === 1 && gs.shoulder.rows.length === 1);
  ok('没练到的部位是 null(不是编一行 0)', gs.back === null && gs.leg === null && gs.calf === null);
}
{
  // 胸里两个动作:卧推 100 今天练(保持 1)、飞鸟 20 停 75 天(压到 0.5 下限)
  // → 胸 = (100×1 + 20×0.5) / 120 = 0.92 —— 大重量主项主导,小的掉了也不至于把整块拖红
  const logs = [
    log(T, [['0025', [[100, 1]]]]),
    log('2026-08-01', [['0308', [[20, 1]]]])
  ];
  const gs = S.groupStrength(S.strengthRows(logs, T));
  ok('计权保持率按「主动/协同 × 历史最好」加权', gs.chest.retained === 0.92, String(gs.chest.retained));
  ok('0.92 落在「掉了一截」档', S.strengthTone(gs.chest.retained) === 'ok');
  ok('清单按今天大约的成绩从高到低', gs.chest.rows[0].exerciseId === '0025'
    && gs.chest.rows[1].exerciseId === '0308', gs.chest.rows.map((r) => r.exerciseId).join());
  ok('肩 = (50×1 + 10×0.5) / 60 ≈ 0.92(两边都是半份权)', gs.shoulder.retained === 0.92, String(gs.shoulder.retained));
  ok('手臂只有卧推半份 → 保持 100%', gs.arm.retained === 1);
}
{
  // 硬拉:臀腿主、下背协同 —— 一个动作同时出现在两组里
  const gs = S.groupStrength(S.strengthRows([log(T, [['0032', [[140, 1]]]])], T));
  ok('臀腿(主)和背(协同)各有一行', gs.leg.rows.length === 1 && gs.back.rows.length === 1
    && gs.leg.retained === 1 && gs.back.retained === 1);
}
{
  // 动作库里查不到的 id:成绩行在,但归不进任何组 —— 不猜它练哪
  const gs = S.groupStrength(S.strengthRows([log(T, [['zzz', [[50, 1]]]])], T));
  ok('查不到的动作不上身体图', ['chest','back','shoulder','arm','core','leg','calf']
    .every((g) => gs[g] === null));
  ok('空清单也不炸', S.groupStrength([]).chest === null);
}
section('配色档刻度');
ok('95% 及以上算保持住了(和 isFaded 同一条线)', S.strengthTone(1) === 'fresh' && S.strengthTone(0.95) === 'fresh');
ok('85%-95% 算掉了一截', S.strengthTone(0.94) === 'ok' && S.strengthTone(0.85) === 'ok');
ok('85% 以下算掉得多(约停练一个月)', S.strengthTone(0.84) === 'tired' && S.strengthTone(0.5) === 'tired');

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
