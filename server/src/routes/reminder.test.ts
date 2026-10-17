import test from 'node:test';
import assert from 'node:assert/strict';
import { ReminderSchema, GrantSchema, nextLastSentOn, MAX_GRANTS } from './reminder';
import { dueNow, dueReminders, excusedOn, hhmmToMin, localDay, type ReminderRow } from '../lib/reminderSchedule';
import { PUSH_LINES, PUSH_SUBJECT, pushLine, TICK_MIN } from '../lib/reminderRunner';
import { clip, remindData, timeText, tokenFresh, REMIND_FIELDS } from '../lib/wechatSend';

/** 东八区用户,本地 2026-10-15 20:00 → UTC 12:00 */
const CN = 480;
const atLocal = (hhmm: string, day = '2026-10-15') => Date.parse(`${day}T${hhmm}:00Z`) - CN * 60000;

const row = (over: Partial<ReminderRow> = {}): ReminderRow => ({
  id: 'r1',
  enabled: true,
  time: '20:00',
  tzOffsetMin: CN,
  grants: 1,
  lastSentOn: null,
  ...over
});

test('设置表单:时间格式和时区范围都要挡住', () => {
  const good = { enabled: true, time: '20:00', tone: 'gentle', nudge: true, tzOffsetMin: 480 };
  assert.equal(ReminderSchema.safeParse(good).success, true);
  assert.equal(ReminderSchema.safeParse({ ...good, time: '25:00' }).success, false);
  assert.equal(ReminderSchema.safeParse({ ...good, time: '8:00' }).success, false, '要补零');
  assert.equal(ReminderSchema.safeParse({ ...good, tone: '凶巴巴' }).success, false, '语气只认三档');
  assert.equal(ReminderSchema.safeParse({ ...good, tzOffsetMin: 2000 }).success, false, '时区不可能偏 33 小时');
  assert.equal(GrantSchema.safeParse({ accepted: 1 }).success, true);
  assert.equal(GrantSchema.safeParse({ accepted: -1 }).success, false);
  assert.equal(GrantSchema.safeParse({ accepted: MAX_GRANTS + 1 }).success, false);
});

test('到点了才发:早一分钟不发,过了午夜也不再补', () => {
  assert.equal(dueNow(row(), atLocal('19:59')), false, '还没到点');
  assert.equal(dueNow(row(), atLocal('20:00')), true, '正好到点');
  assert.equal(dueNow(row(), atLocal('20:30')), true, '晚半小时仍然发');
  assert.equal(dueNow(row(), atLocal('23:00')), true, '晚 3 小时还发');
  assert.equal(dueNow(row(), atLocal('23:59')), true, '当天最后一分钟还发');
  assert.equal(dueNow(row(), atLocal('00:30', '2026-10-16')), false, '过了午夜就当这条错过了 —— 凌晨推「该练了」比不推更糟');
  // 宽限本身也生效:把窗口设成 5 分钟,晚 10 分钟就不发
  assert.equal(dueNow(row(), atLocal('20:10'), 5), false, '窄窗口下晚 10 分钟不发');
  assert.equal(dueNow(row(), atLocal('20:04'), 5), true, '窄窗口内照发');
});

test('一天最多一条,而且「今天」按用户本地日期算', () => {
  const sent = row({ lastSentOn: '2026-10-15' });
  assert.equal(dueNow(sent, atLocal('20:00')), false, '今天已经发过了');
  assert.equal(dueNow(sent, atLocal('20:00', '2026-10-16')), true, '第二天照常发');
  // 东八区 20:00 是 UTC 12:00,服务端如果按 UTC 日期去重会算成「前一天」而重复发
  assert.equal(localDay(atLocal('20:00'), CN), '2026-10-15');
  assert.equal(localDay(atLocal('08:00'), CN), '2026-10-15');
  assert.equal(localDay(Date.parse('2026-10-15T23:00:00Z'), CN), '2026-10-16', 'UTC 还在 15 号,东八区已经是 16 号');
});

test('时区真的会换算:同一时刻,东八区和 UTC 用户的「到点没」不一样', () => {
  const now = Date.parse('2026-10-15T12:00:00Z'); // 北京 20:00 / 伦敦 12:00
  assert.equal(dueNow(row(), now), true, '东八区用户:正好晚上 8 点');
  assert.equal(dueNow(row({ tzOffsetMin: 0 }), now), false, 'UTC 用户:才中午 12 点,不是他的 8 点');
  assert.equal(dueNow(row({ tzOffsetMin: 0, time: '12:00' }), now), true, 'UTC 用户把提醒设在 12:00 就到点了');
});

test('没有额度就不发 —— 一次授权只能发一条,发完必须停', () => {
  assert.equal(dueNow(row({ grants: 0 }), atLocal('20:00')), false);
  assert.equal(dueNow(row({ grants: 3 }), atLocal('20:00')), true);
  assert.equal(dueNow(row({ enabled: false }), atLocal('20:00')), false, '关掉了就不发');
});

test('脏数据宁可不发,也不猜', () => {
  assert.equal(hhmmToMin('20:00'), 1200);
  assert.equal(hhmmToMin('乱写的'), null);
  assert.equal(hhmmToMin(''), null);
  assert.equal(dueNow(row({ time: '乱写的' }), atLocal('20:00')), false);
  assert.equal(dueNow(row({ tzOffsetMin: NaN }), atLocal('20:00')), true, '时区缺失退回东八区,而不是整条哑掉');
});

test('一轮里挑出所有该发的,顺序不变', () => {
  const now = atLocal('20:05');
  const rows = [
    row({ id: 'a' }),
    row({ id: 'b', grants: 0 }),
    row({ id: 'c', time: '21:00' }),
    row({ id: 'd', tzOffsetMin: 0 })
  ];
  assert.deepEqual(dueReminders(rows, now).map((r) => r.id), ['a']);
});

test('保存设置时:到点时间已经过了就记为今天已发(别当场烧掉唯一的授权)', () => {
  const input = { enabled: true, time: '20:00', tzOffsetMin: CN };
  assert.equal(nextLastSentOn(null, input, atLocal('19:00')), null, '还没到点,今天该发还得发');
  assert.equal(nextLastSentOn(null, input, atLocal('20:00')), null, '正好到点,交给自己那一刻的轮询');
  assert.equal(nextLastSentOn(null, input, atLocal('22:00')), '2026-10-15', '晚上 10 点才设 20:00 的提醒 → 从明天开始');
  assert.equal(nextLastSentOn('2026-10-15', { ...input, time: '21:00' }, atLocal('20:30')), '2026-10-15', '今天已经发过,改时间也不当天补第二条');
  assert.equal(nextLastSentOn('2026-10-14', input, atLocal('20:30')), '2026-10-15', '昨天发的不影响今天');
  assert.equal(nextLastSentOn(null, { ...input, enabled: false }, atLocal('22:00')), null, '关掉了就不动它');
});

test('推送文案:三档语气各一句,且不许出现禁词', () => {
  assert.equal(pushLine('fun'), PUSH_LINES.fun);
  assert.equal(pushLine('不认识的语气'), PUSH_LINES.gentle, '认不出来就温和,不是空白');
  assert.ok(pushLine('') .length > 0);
  const all = [PUSH_SUBJECT, ...Object.values(PUSH_LINES)];
  assert.equal(all.some((t) => /AI|智能|大模型|智谱/i.test(t)), false, '推送文案是用户直接看到的,禁词红线');
  assert.equal(all.every((t) => t.length > 0 && t.length <= 30), true);
  assert.equal(TICK_MIN > 0 && TICK_MIN <= 15, true, '轮询间隔要落在合理范围');
});

test('微信模板字段:超长要截断,换行要清掉(整条被拒比少几个字糟得多)', () => {
  assert.equal(clip('短'), '短');
  assert.equal(clip('中'.repeat(25)).length, 20);
  assert.equal(clip('中'.repeat(25)).endsWith('…'), true);
  assert.equal(clip('第一行\n第二行'), '第一行 第二行');
  assert.equal(clip(''), '');

  const data = remindData(PUSH_SUBJECT, pushLine('gentle'), new Date(2026, 9, 15, 20, 0));
  assert.deepEqual(Object.keys(data), [REMIND_FIELDS.subject, REMIND_FIELDS.when, REMIND_FIELDS.note]);
  assert.equal(data[REMIND_FIELDS.subject].value, PUSH_SUBJECT);
  assert.equal(data[REMIND_FIELDS.note].value, PUSH_LINES.gentle);
  assert.equal(data[REMIND_FIELDS.when].value, '2026-10-15 20:00');
  assert.equal(timeText(new Date(2026, 0, 5, 8, 7)), '2026-01-05 08:07', '补零');
});

test('请假那天不推 —— 服务器发的消息是唯一没法在客户端拦掉的那条', () => {
  const day = '2026-10-15';
  assert.equal(excusedOn({ [day]: { kind: 'sick', text: '低烧', at: '' } }, day), true);
  assert.equal(excusedOn({ [day]: { kind: 'travel' } }, day), true, '四种原因都算');
  assert.equal(excusedOn({ '2026-10-14': { kind: 'sick' } }, day), false, '别的日子请的假不影响今天');
});

test('请假条读不懂时宁可多发一条,也不能永久吞掉提醒', () => {
  const day = '2026-10-15';
  assert.equal(excusedOn(null, day), false, '还没同步过');
  assert.equal(excusedOn({}, day), false);
  assert.equal(excusedOn([], day), false, '数组不是请假表');
  assert.equal(excusedOn('sick', day), false);
  assert.equal(excusedOn({ [day]: 'sick' }, day), false, '值不是对象');
  assert.equal(excusedOn({ [day]: { kind: '感冒' } }, day), false, '原因不认识就不认这一天');
  assert.equal(excusedOn({ [day]: { kind: '' } }, day), false);
});

test('access_token 快过期就当作要用新的', () => {
  const now = 1_000_000_000_000;
  assert.equal(tokenFresh(now, now + 60 * 60 * 1000), true, '还有一小时');
  assert.equal(tokenFresh(now, now + 4 * 60 * 1000), false, '只剩 4 分钟 → 提前换');
  assert.equal(tokenFresh(now, now - 1000), false, '已经过期');
});
