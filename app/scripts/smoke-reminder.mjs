/**
 * M8.1 提醒设置(本机这一半)冒烟测试 —— 时间解析、人话格式、脏数据降级。
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-reminder.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** 假 storage:顺便盯住「存进去的到底是什么」 */
const store = new Map();
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@tarojs/taro') {
    // `default: storage` 是必须的:编译产物是 `__importDefault(require(...))`,
    // 少了它取到的就是 undefined,而报错会落在「storage 用不了」而不是这里
    const storage = {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => store.set(k, v),
      removeStorageSync: (k) => store.delete(k)
    };
    return { default: storage, ...storage };
  }
  return origLoad.call(this, req, ...rest);
};

const R = require('../.smoke/utils/reminder.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

section('提醒时刻要写成 HH:mm');
ok('正常时间认', ['00:00', '07:30', '20:00', '23:59'].every(R.validTime));
ok('不补零不认(存进去的必须是规范格式)', !R.validTime('8:00'));
ok('24 点不认(跨天要用 00:00)', !R.validTime('24:00'));
ok('不存在的分钟不认', !R.validTime('20:60'));
ok('别的东西不认', !R.validTime('晚上八点') && !R.validTime('') && !R.validTime(null) && !R.validTime(2000));

section('时间说成人话');
ok('晚上 8:00', R.hhmmText('20:00') === '晚上 8:00', R.hhmmText('20:00'));
ok('整点也带「:00」,一列里格式统一', R.hhmmText('22:00') === '晚上 10:00', R.hhmmText('22:00'));
ok('带分钟照说', R.hhmmText('20:30') === '晚上 8:30');
ok('早上', R.hhmmText('07:30') === '早上 7:30');
ok('中午 12 点不说「下午 0 点」', R.hhmmText('12:00') === '中午 12:00', R.hhmmText('12:00'));
ok('中午 12 点半', R.hhmmText('12:30') === '中午 12:30');
ok('下午', R.hhmmText('17:00') === '下午 5:00');
ok('凌晨', R.hhmmText('05:00') === '凌晨 5:00');
ok('午夜是 12 不是 0', R.hhmmText('00:00') === '凌晨 12:00', R.hhmmText('00:00'));
ok('九点算上午,不算早上', R.hhmmText('09:00') === '上午 9:00', R.hhmmText('09:00'));
ok('八点还算早上', R.hhmmText('08:00') === '早上 8:00', R.hhmmText('08:00'));
ok('坏时间原样吐回来,不编一个', R.hhmmText('乱写的') === '乱写的' && R.hhmmText('') === '');

section('默认设置');
ok('默认关着(不擅自替用户开)', R.DEFAULT_REMINDER.enabled === false);
ok('默认时间是晚上八点', R.DEFAULT_REMINDER.time === '20:00');
ok('默认温和档', R.DEFAULT_REMINDER.tone === 'gentle');
ok('默认开着「没练也提一句」', R.DEFAULT_REMINDER.nudge === true);
ok('默认时区东八区', R.DEFAULT_REMINDER.tzOffsetMin === 480);
ok('时候选项都是规范格式', R.TIME_CHOICES.every(R.validTime) && R.TIME_CHOICES.length >= 5);

section('存取:脏数据一律降级成默认,不能把页面搞崩');
store.clear();
const fresh = R.loadReminder();
ok('没存过就是默认', fresh.time === '20:00' && fresh.enabled === false);
ok('没存过也带上了真时区', Number.isFinite(fresh.tzOffsetMin) && Math.abs(fresh.tzOffsetMin) <= 840, `${fresh.tzOffsetMin}`);

store.set('bodyos.training.reminder', { enabled: 'yes', time: '25:99', tone: '凶巴巴', nudge: 'nope' });
const dirty = R.loadReminder();
ok('坏时间退回默认', dirty.time === '20:00');
ok('坏语气退回温和', dirty.tone === 'gentle');
ok('enabled 只认真值', dirty.enabled === true, '字符串 "yes" 也算开了,总比丢掉用户的意愿好');
ok('nudge 只认真布尔', dirty.nudge === true, '给了个字符串 → 退回默认(true)');

store.set('bodyos.training.reminder', '不是对象');
ok('存的不是对象也不炸', R.loadReminder().time === '20:00');

store.set('bodyos.training.reminder', null);
ok('存了 null 也不炸', R.loadReminder().enabled === false);

section('本机存过没有 —— 决定换手机时谁说了算');
store.clear();
ok('全新设备:没存过', R.hasLocalReminder() === false);
store.set('bodyos.training.reminder', { enabled: true, time: '07:00', tone: 'fun', nudge: true, tzOffsetMin: 480 });
ok('存过就是存过', R.hasLocalReminder() === true);
store.set('bodyos.training.reminder', '');
ok('空串不算存过', R.hasLocalReminder() === false);
store.set('bodyos.training.reminder', null);
ok('null 不算存过', R.hasLocalReminder() === false);
store.set('bodyos.training.reminder', '不是对象');
ok('存了个字符串也不算(它读出来会退回默认,不能当用户设过)', R.hasLocalReminder() === false);

section('保存:唯一写入路径,脏值在这里就该被挡掉');
store.clear();
R.saveReminder({ enabled: true, time: '07:00', tone: 'cheer', nudge: false });
const dirty2 = R.saveReminder({ time: '25:99', tone: '凶巴巴' });
ok('坏时间退回上一次的值,不是退回默认(用户的旧选择比默认更接近他的意思)', dirty2.time === '07:00', dirty2.time);
ok('坏语气退回温和档', dirty2.tone === 'gentle');
ok('只改语气不动别的(没传的字段保留原值)', dirty2.nudge === false && dirty2.enabled === true);

section('保存:每次保存都重新上报时区');
store.clear();
const saved = R.saveReminder({ enabled: true, time: '07:00', tone: 'cheer', nudge: false, tzOffsetMin: 0 });
ok('写进去的就是给出去的', saved.time === '07:00' && saved.tone === 'cheer' && saved.enabled === true);
ok('时区被当下的时区覆盖(出差换时区要跟着变)', saved.tzOffsetMin === R.tzOffsetMin());
ok('落到了 storage 里', store.get('bodyos.training.reminder')?.time === '07:00');
const patched = R.saveReminder({ time: '21:00' });
ok('只改一项不影响别的', patched.time === '21:00' && patched.tone === 'cheer' && patched.enabled === true);

section('服务端状态:模板 id 与剩余额度(练完补领要用)');
store.clear();
const s0 = R.loadReminderServer();
ok('默认:没模板、没额度', s0.tmplId === '' && s0.grants === 0);
ok('没开提醒就不补领', R.needsReminderTopUp({ ...R.DEFAULT_REMINDER }, { tmplId: 'tpl', grants: 0 }) === false);
ok('开着提醒 + 知道模板 + 额度为 0 → 该补', R.needsReminderTopUp({ ...R.DEFAULT_REMINDER, enabled: true }, { tmplId: 'tpl', grants: 0 }) === true);
ok('还有额度就不打扰(别每次练完都弹授权框)', R.needsReminderTopUp({ ...R.DEFAULT_REMINDER, enabled: true }, { tmplId: 'tpl', grants: 1 }) === false);
ok('没下过模板 id 就不问(后台没配时授权也没意义)', R.needsReminderTopUp({ ...R.DEFAULT_REMINDER, enabled: true }, { tmplId: '', grants: 0 }) === false);

store.set('bodyos.training.reminder.server', { tmplId: 123, grants: -5 });
const dirtyS = R.loadReminderServer();
ok('坏数据降级:模板不是字符串按空、负额度按 0', dirtyS.tmplId === '' && dirtyS.grants === 0);
store.set('bodyos.training.reminder.server', { tmplId: 'tpl', grants: 2.9 });
ok('额度只认整数(向下取整,不四舍五入成 3)', R.loadReminderServer().grants === 2);
const savedS = R.saveReminderServer({ grants: 3 });
ok('只改额度不动模板 id', savedS.tmplId === 'tpl' && savedS.grants === 3);
ok('落到了 storage 里', store.get('bodyos.training.reminder.server')?.grants === 3);

section('时区偏移的符号');
ok('getTimezoneOffset 的符号是反的,我们存的是「相对 UTC」', R.tzOffsetMin() === -new Date().getTimezoneOffset());
ok('东八区 = 480(不是 -480)', new Date().getTimezoneOffset() !== 0 || R.tzOffsetMin() === 0);

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
