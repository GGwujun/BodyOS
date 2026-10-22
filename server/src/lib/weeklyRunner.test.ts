import test from 'node:test';
import assert from 'node:assert/strict';
import { dueWeeklyMonday, SEND_HOUR, weeklyDigest } from './weeklyRunner';
import { weeklyData, WEEKLY_FIELDS, THING_MAX } from './wechatSend';

/** 东八区 */
const CN = 480;
/** 造一个「用户本地某日某时」的时间戳 */
const atLocal = (hhmm: string, day = '2026-10-19') => Date.parse(`${day}T${hhmm}:00Z`) - CN * 60000;

// 2026-10-19 是周一;上一周(要报告的那周)是 2026-10-12 ~ 10-18
const MONDAY = '2026-10-19';

test('只有本地周一 08:00 起才发,其余一概不动', () => {
  assert.equal(dueWeeklyMonday(atLocal('07:59', MONDAY), CN), null, '差一分钟也不发');
  assert.equal(dueWeeklyMonday(atLocal('08:00', MONDAY), CN), MONDAY, '到点,返回本地日期供去重');
  assert.equal(dueWeeklyMonday(atLocal('23:00', MONDAY), CN), MONDAY, '当天晚些时候仍发(报告的是上周,不存在「过了就别提」)');
  assert.equal(dueWeeklyMonday(atLocal('08:00', '2026-10-20'), CN), null, '周二不发');
  assert.equal(dueWeeklyMonday(atLocal('08:00', '2026-10-18'), CN), null, '周日不发');
  assert.equal(SEND_HOUR, 8);
});

test('同一时刻,不同时区用户的「周一」不一样', () => {
  // 北京周一 08:00 = UTC 周日 00:00 —— UTC 用户还在周日,不该发
  const now = atLocal('08:00', MONDAY);
  assert.equal(dueWeeklyMonday(now, CN), MONDAY);
  assert.equal(dueWeeklyMonday(now, 0), null, 'UTC 用户此刻是周日 00:00');
});

test('weeklyData:五个字段的文案与兜底', () => {
  const data = weeklyData({ weekStart: '2026-10-12', avgScore: 82.4, weightChangeKg: -0.5, recordedDays: 6, highlight: '' });
  assert.equal(data[WEEKLY_FIELDS.range]?.value, '10月12日-10月18日');
  assert.equal(data[WEEKLY_FIELDS.score]?.value, '本周均分 82');
  assert.equal(data[WEEKLY_FIELDS.weight]?.value, '体重 -0.5kg');
  assert.equal(data[WEEKLY_FIELDS.days]?.value, '记录 6/7 天');
  assert.equal(data[WEEKLY_FIELDS.note]?.value, '新的一周,继续记录就有报告看', '没有亮点时给中性的话');
});

test('weeklyData:没评分/没称重/涨体重/跨月周期', () => {
  const data = weeklyData({ weekStart: '2026-09-28', avgScore: null, weightChangeKg: null, recordedDays: 0, highlight: '坚持记录了两周' });
  assert.equal(data[WEEKLY_FIELDS.range]?.value, '9月28日-10月4日', '跨月要进位,不能写出 9月34日');
  assert.equal(data[WEEKLY_FIELDS.score]?.value, '本周还没有评分');
  assert.equal(data[WEEKLY_FIELDS.weight]?.value, '本周没称体重');
  assert.equal(data[WEEKLY_FIELDS.days]?.value, '记录 0/7 天');
  assert.equal(data[WEEKLY_FIELDS.note]?.value, '坚持记录了两周');
  const up = weeklyData({ weekStart: '2026-10-12', avgScore: 70, weightChangeKg: 0.5, recordedDays: 7, highlight: '' });
  assert.equal(up[WEEKLY_FIELDS.weight]?.value, '体重 +0.5kg', '涨的体重要带 + 号');
});

test('weeklyData:超长亮点要截到 20 字(微信会整条拒发)', () => {
  const long = '本周完成了全部五次训练而且睡眠时间明显变长了';
  const data = weeklyData({ weekStart: '2026-10-12', avgScore: 80, weightChangeKg: null, recordedDays: 5, highlight: long });
  const note = data[WEEKLY_FIELDS.note]?.value ?? '';
  assert.ok(note.length <= THING_MAX, `截完不能超过 ${THING_MAX} 字,现在是 ${note.length}`);
  assert.ok(note.endsWith('…'));
});

test('weeklyDigest:聚合口径(均分/体重差/按天去重的记录天数/亮点)', async () => {
  const calls: { model: string; args: unknown }[] = [];
  const fake = (model: string) => (fn: string) => (args: unknown) => {
    calls.push({ model, args });
    if (model === 'dailySummary' && fn === 'findMany') {
      return [
        { date: new Date('2026-10-12'), bodyScore: 80, intakeCalories: 1800, burnCalories: 200, steps: 6000 },
        { date: new Date('2026-10-12'), bodyScore: 90, intakeCalories: 400, burnCalories: null, steps: 0 }, // 同一天第二顿:只算一天
        { date: new Date('2026-10-14'), bodyScore: null, intakeCalories: 0, burnCalories: null, steps: 300 }, // 只走了路,也算有记录
        { date: new Date('2026-10-15'), bodyScore: null, intakeCalories: 0, burnCalories: null, steps: 0 } // 什么都没有:不算
      ];
    }
    if (model === 'bodyMeasurement' && fn === 'findMany') {
      return [
        { weightKg: 70.0 },
        { weightKg: 69.2 }
      ];
    }
    if (model === 'weeklyReport' && fn === 'findUnique') {
      return { content: { wins: ['深蹲加到了 100kg', '别的亮点'] } };
    }
    return null;
  };

  const prisma = await import('../db');
  const orig = { ...prisma.prisma } as unknown as Record<string, unknown>;
  const restore: Record<string, unknown> = {};
  for (const m of ['dailySummary', 'bodyMeasurement', 'weeklyReport']) {
    restore[m] = (prisma.prisma as unknown as Record<string, unknown>)[m];
    (prisma.prisma as unknown as Record<string, unknown>)[m] = new Proxy({}, { get: (_t, fn) => fake(m)(String(fn)) });
  }

  try {
    const out = await weeklyDigest('u1', '2026-10-12');
    assert.equal(out.avgScore, 85, '均分只算有评分的天');
    assert.equal(out.weightChangeKg, -0.8, '首末两次称重的差,四舍五入到 0.1');
    assert.equal(out.recordedDays, 2, '10-12 两条只算一天,10-14 走路算,10-15 不算');
    assert.equal(out.highlight, '深蹲加到了 100kg', '亮点取已生成周报的第一条 win');
    assert.equal(calls.filter((c) => c.model === 'dailySummary').length, 1);
  } finally {
    Object.assign(prisma.prisma as unknown as Record<string, unknown>, restore);
    void orig;
  }
});
