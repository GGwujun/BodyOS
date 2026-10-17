/**
 * 离开守卫(utils/leave-guard)冒烟测试。
 *
 * 钉的是三件事:
 *   ① **默认放行** —— 没登记、或者登记的那个说「不脏」,就不许弹窗挡路
 *      (否则每个页面点底栏都多一次弹窗,那就成了新的毛病);
 *   ② 「脏不脏」是**问的那一刻**算的,不是登记那一刻定死的(状态可能已经落盘);
 *   ③ 原生返回那个开关(enableAlertBeforeUnload)在 weapp 之外的平台**没有**,
 *      没有不能炸 —— H5 里点一下底栏就白屏是最糟的结果。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-leave-guard.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** showModal 的假实现:记下每次被问到的内容,由用例决定用户点了哪一边 */
let asked = [];
let answer = true;
let native = [];
const storage = {};
const taro = {
  showModal: async (opt) => { asked.push(opt); return { confirm: answer, cancel: !answer }; },
  enableAlertBeforeUnload: (opt) => native.push(['on', opt?.message]),
  disableAlertBeforeUnload: () => native.push(['off'])
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') return { default: taro, ...taro, ...storage };
  return origLoad.call(this, req, ...rest);
};

const G = require('../.smoke/utils/leave-guard.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);
const reset = () => { asked = []; answer = true; native = []; G.setLeaveGuard(null); };

const guard = (dirty, over = {}) => ({
  dirty: () => dirty,
  title: '放弃这次训练?',
  content: '这次训练还没结束。',
  ...over
});

section('没话说就直接放行(底栏不该每次点都弹一下)');
reset();
ok('没登记守卫 → 放行', (await G.confirmLeave()) === true);
ok('而且没弹窗', asked.length === 0);
G.setLeaveGuard(guard(false));
ok('登记了、但不脏 → 放行', (await G.confirmLeave()) === true);
ok('还是不弹窗', asked.length === 0);
ok('peek 拿得到现在登记的那个', G.peekLeaveGuard()?.title === '放弃这次训练?');
G.setLeaveGuard(null);
ok('注销之后 → 放行', (await G.confirmLeave()) === true && G.peekLeaveGuard() === null);

section('脏了就问一句,答什么是什么');
reset();
G.setLeaveGuard(guard(true, { confirmText: '放弃' }));
answer = false;
ok('用户点了「留下」→ 不放行', (await G.confirmLeave()) === false);
ok('弹的是页面自己那句话(标题/正文/按钮字都透传)',
  asked.length === 1 && asked[0].title === '放弃这次训练?' && asked[0].content === '这次训练还没结束。'
  && asked[0].confirmText === '放弃' && asked[0].cancelText === '留下',
  JSON.stringify(asked[0]));
reset();
G.setLeaveGuard(guard(true));
ok('用户点了「放弃」→ 放行', (await G.confirmLeave()) === true);
reset();
G.setLeaveGuard(guard(true, { confirmText: undefined }));
await G.confirmLeave();
ok('没给按钮字 → 有个默认的,不会出现空按钮', asked[0].confirmText === '放弃');

section('脏不脏是问的那一刻算的(不是登记那一刻定死的)');
reset();
let dirty = true;
G.setLeaveGuard({ ...guard(true), dirty: () => dirty });
answer = false;
ok('第一次:脏 → 拦住', (await G.confirmLeave()) === false && asked.length === 1);
dirty = false;
ok('后来落盘了 → 同一份守卫不再拦', (await G.confirmLeave()) === true && asked.length === 1);

section('原生返回那个开关');
reset();
G.syncNativeGuard(true, '还没结束呢');
ok('开着的时候带上自己那句话', native.length === 1 && native[0][0] === 'on' && native[0][1] === '还没结束呢', JSON.stringify(native));
G.syncNativeGuard(false);
ok('关掉(自己跳转时不能让用户再点一次弹窗)', native.length === 2 && native[1][0] === 'off');
reset();
const keep = taro.enableAlertBeforeUnload;
delete taro.enableAlertBeforeUnload;
delete taro.disableAlertBeforeUnload;
let threw = false;
try { G.syncNativeGuard(true); G.syncNativeGuard(false); } catch { threw = true; }
ok('平台没有这个 API(H5/开发工具)→ 静默跳过,不炸', !threw);
taro.enableAlertBeforeUnload = keep;
reset();
let threw2 = false;
taro.enableAlertBeforeUnload = () => { throw new Error('页面已销毁'); };
try { G.syncNativeGuard(true); } catch { threw2 = true; }
ok('原生调用自己抛异常也不影响正常流程', !threw2);
taro.enableAlertBeforeUnload = keep;

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
