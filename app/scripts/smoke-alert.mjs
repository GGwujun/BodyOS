/**
 * 训练提示(engine/alert)冒烟测试。
 *
 * 钉的是四件事:
 *   ① **设置的清洗** —— 读不懂的项退回默认值而不是丢整份(这是一份设置,不是数据);
 *   ② **两个开关都得真的说了算** —— 保屏关掉之后一次都不许再亮屏、震动关掉之后
 *      一次都不许再震(提示最容易出的错不是"没响",是"关不掉");
 *   ③ **哪个提示点震多长** —— 休息结束是长震(那是 openGym 那个更急的
 *      [200,100,200] 在这个平台上的唯一翻译),其余短震;
 *   ④ **3/2/1 的边界** —— 0 不是预告(那是结束那一下),4 及以上什么都没到。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-alert.mjs
 *
 * ⚠️ 这里的 `@tarojs/taro` 桩必须比引擎模块先装好(所以用 createRequire 而不是
 * import —— ESM 的 import 会被提升到这些语句之前),和别的套件同一个道理。
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);

/** 假 storage + 记下每一次震动/亮屏调用;`taro` 单独留一份引用,好让用例把接口删掉演"机型没有" */
const store = new Map();
let buzzCalls = [];      // [type|null, 'short'|'long']
let screenCalls = [];    // true / false
let taro = null;

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    taro = {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => store.set(k, v),
      removeStorageSync: (k) => store.delete(k),
      vibrateShort: (opt) => { buzzCalls.push([opt?.type ?? null, 'short']); return Promise.resolve({}); },
      vibrateLong: () => { buzzCalls.push([null, 'long']); return Promise.resolve({}); },
      setKeepScreenOn: (opt) => { screenCalls.push(!!opt?.keepScreenOn); return Promise.resolve({}); }
    };
    // `default` 那份不能省:编译产物是 __importDefault(require(...)),会去拿 `.default`。
    // 这里让 default 指回自己(并且标上 __esModule,免得 __importDefault 再包一层)——
    // 包一层的话引擎手里那个 Taro 就是**另一个对象**了,下面那几个用例
    // `delete taro.vibrateShort` 删的就不是它真正在用的那个(踩过:两条报"静默"的用例因此红)。
    taro.__esModule = true;
    taro.default = taro;
    return taro;
  }
  return origLoad.call(this, req, ...rest);
};

const A = require('../.smoke/pkg-exercise/engine/alert.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);
/** 等一个宏任务回合,让内部的 `Promise.resolve(...).catch()` 真的发出去 */
const flush = () => new Promise((r) => setTimeout(r, 0));
/** 动过的手脚复原 —— 每个会动全局的用例自己收尾,免得串到下一节(这个坑 sync/history 都踩过) */
const restore = () => { buzzCalls = []; screenCalls = []; store.clear(); };

section('设置的清洗 —— 逐项判类型,坏了退回默认值而不是丢整份');
ok('全空 → 默认那份', JSON.stringify(A.sanitizeAlert(null)) === JSON.stringify(A.ALERT_DEFAULT));
ok('不是对象也认(字符串/数字/数组)',
  A.sanitizeAlert('x').keepAwake === true && A.sanitizeAlert(0).vibrate === true
  && JSON.stringify(A.sanitizeAlert([])) === JSON.stringify(A.ALERT_DEFAULT));
ok('两项默认都开(照 openGym:vibrate 默认 on、keepAwake 只在明确为 false 时才不保屏)',
  A.ALERT_DEFAULT.keepAwake === true && A.ALERT_DEFAULT.vibrate === true);
ok('给全了照用', A.sanitizeAlert({ keepAwake: false, vibrate: false }).keepAwake === false
  && A.sanitizeAlert({ keepAwake: false, vibrate: false }).vibrate === false);
ok('一项坏只坏那一项(另一项照用)',
  A.sanitizeAlert({ keepAwake: 'no', vibrate: false }).keepAwake === true
  && A.sanitizeAlert({ keepAwake: 'no', vibrate: false }).vibrate === false);
ok('不是布尔的都退回默认(0 / 字符串 / null 都不算布尔)',
  A.sanitizeAlert({ keepAwake: 0 }).keepAwake === true
  && A.sanitizeAlert({ keepAwake: 'false' }).keepAwake === true
  && A.sanitizeAlert({ vibrate: null }).vibrate === true);
ok('多余字段不会被带出去(存的是清洗过的那个形状)',
  Object.keys(A.sanitizeAlert({ keepAwake: true, vibrate: true, sound: true })).sort().join(',') === 'keepAwake,vibrate');

section('存 / 读');
restore();
ok('没存过 → 默认', A.loadAlert().vibrate === true);
const saved = A.saveAlert({ vibrate: false });
ok('存下来的就是返回的那份', saved.vibrate === false && saved.keepAwake === true);
ok('读得回来', A.loadAlert().vibrate === false && A.loadAlert().keepAwake === true);
ok('只改一项不动另一项', A.saveAlert({ keepAwake: false }).vibrate === false);
ok('存的键就是那个(改键名就会一路读到默认值,这条防的是手滑)',
  store.has(A.ALERT_KEY) && A.ALERT_KEY === 'bodyos.training.alert');
store.set(A.ALERT_KEY, 'garbage');
let threw = false;
let recovered = false;
try { recovered = A.loadAlert().vibrate === true; } catch { threw = true; }
ok('存储里被塞了脏东西 → 退回默认,不抛', !threw && recovered);

section('哪个提示点多长');
ok('休息结束 → 长震(更急的那一下)', A.CUE_BUZZ.restEnd === 'long');
ok('勾完一组 → 短震', A.CUE_BUZZ.setDone === 'short');
ok('最后 3 秒的预告 → 短震', A.CUE_BUZZ.tick === 'short');
ok('三个提示点里只有休息结束是长震', Object.values(A.CUE_BUZZ).join(',') === 'short,short,long');

section('震动:真的发出去、而且关得掉');
restore();
A.buzz('restEnd', { keepAwake: true, vibrate: true });
await flush();
ok('开着 → 长震发了一次', buzzCalls.length === 1 && buzzCalls[0][1] === 'long', JSON.stringify(buzzCalls));
buzzCalls = [];
A.buzz('setDone', { keepAwake: true, vibrate: true });
await flush();
ok('短震带上 medium(不传的话部分机型按最轻那档处理)', buzzCalls[0]?.[0] === 'medium');
buzzCalls = [];
A.buzz('tick', { keepAwake: true, vibrate: false });
await flush();
ok('关掉震动 → 一个字都不发', buzzCalls.length === 0);
A.buzz('restEnd', { keepAwake: true, vibrate: false });
await flush();
ok('关掉之后长震也一样不发', buzzCalls.length === 0);
delete taro.vibrateShort;
delete taro.vibrateLong;
threw = false;
try { A.buzz('setDone', { keepAwake: true, vibrate: true }); await flush(); } catch { threw = true; }
ok('机型没有震动接口 → 静默,不炸(这页的正事是记录训练)', !threw && buzzCalls.length === 0);
taro.vibrateShort = (opt) => { buzzCalls.push([opt?.type ?? null, 'short']); return Promise.resolve({}); };
taro.vibrateLong = () => { buzzCalls.push([null, 'long']); return Promise.resolve({}); };
restore();

section('屏幕常亮:一次性的那个特性');
restore();
A.keepAwake(true, { keepAwake: true, vibrate: true });
await flush();
ok('想保屏且设置开着 → 亮', screenCalls.length === 1 && screenCalls[0] === true);
screenCalls = [];
// 这一节的要害:**离开小程序就失效**,所以回到前台必须重设一遍。这里演的正是那两次调用
A.keepAwake(true, { keepAwake: true, vibrate: true });
A.keepAwake(true, { keepAwake: true, vibrate: true });
await flush();
ok('回前台再调一次 → 再亮一次(没有"已经开过了"的短路,否则回来就是黑屏)',
  screenCalls.length === 2 && screenCalls.every((v) => v === true));
screenCalls = [];
A.keepAwake(false, { keepAwake: true, vibrate: true });
await flush();
ok('离开页面 → 关掉', screenCalls.length === 1 && screenCalls[0] === false);
screenCalls = [];
A.keepAwake(true, { keepAwake: false, vibrate: true });
await flush();
ok('设置里关掉保屏 → 就算正在练也不亮(这个开关必须真的说了算)',
  screenCalls.length === 1 && screenCalls[0] === false);
screenCalls = [];
A.keepAwake(false, { keepAwake: false, vibrate: true });
await flush();
ok('设置关着时传 false 照样发(不能因为设置关着就整段跳过)', screenCalls[0] === false);
screenCalls = [];
delete taro.setKeepScreenOn;
threw = false;
try { A.keepAwake(true, { keepAwake: true, vibrate: true }); await flush(); } catch { threw = true; }
ok('机型没有保屏接口 → 静默,不炸', !threw && screenCalls.length === 0);
restore();

section('3 / 2 / 1 的边界');
ok('剩 3 秒 → 报', A.isTickSecond(3) === true);
ok('剩 2 秒 → 报', A.isTickSecond(2) === true);
ok('剩 1 秒 → 报', A.isTickSecond(1) === true);
ok('剩 0 秒 → **不报**(那是结束那一下,走 restEnd)', A.isTickSecond(0) === false);
ok('剩 4 秒 → 还没到', A.isTickSecond(4) === false);
ok('已经过点了(负数)→ 不报', A.isTickSecond(-1) === false);
ok('小数(定时器反算会出现)不误报', A.isTickSecond(3.4) === false && A.isTickSecond(0.5) === false);

section('这一层不带用户可见文案(红线自查)');
const src = readFileSync(path.resolve(process.cwd(), 'src/pkg-exercise/engine/alert.ts'), 'utf8');
const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
ok('代码里没有禁词(AI / 智能 / 大模型 / 智谱)', !/AI|智能|大模型|智谱/.test(code));
ok('代码里也没有 toast/showToast(提示响不响都不该弹东西)',
  !/showToast|showModal/.test(code));

console.log(`\n${fail === 0 ? '全部通过' : `${fail} 项失败`}`);
process.exit(fail === 0 ? 0 : 1);
