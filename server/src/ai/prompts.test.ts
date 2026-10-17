import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivities } from './prompts';

/**
 * 这层是「模型的输出」和「数据库」之间唯一的闸门。
 * 模型不可信:它会返回字符串数字、空串、多余字段、或者干脆忘了 activities。
 * 每条出去了都必须能过 activity 路由的 zod 校验,否则用户看到的是
 * 「确认保存 → 参数错误」——看不懂、也没法自己修。
 */

test('正常一条跑步:公里换米、坡度落半格', () => {
  const r = normalizeActivities({
    activities: [{ type: '跑步', durationMin: 30, calories: 300, distanceKm: 5.2, inclinePct: 6.3 }],
    confidence: 0.9
  });
  assert.equal(r.activities.length, 1);
  assert.equal(r.activities[0].distanceM, 5200);
  assert.equal(r.activities[0].inclinePct, 6.5, '跑步机没有 6.3 这一档,往半格靠');
  assert.equal(r.activities[0].durationMin, 30);
  assert.equal(r.confidence, 0.9);
});

test('模型把数字写成字符串也认(它经常这么干)', () => {
  const r = normalizeActivities({
    activities: [{ type: '骑行', durationMin: '45', calories: '400', distanceKm: '20' }]
  });
  assert.equal(r.activities[0].durationMin, 45);
  assert.equal(r.activities[0].calories, 400);
  assert.equal(r.activities[0].distanceM, 20000);
});

test('没提到距离/坡度就当作没有,不能凭类型编一个出来', () => {
  const r = normalizeActivities({ activities: [{ type: '跑步', durationMin: 30, calories: 300 }] });
  assert.equal(r.activities[0].distanceM, undefined);
  assert.equal(r.activities[0].inclinePct, undefined);
});

test('距离的单位混乱要挡住:把 5000(米)当公里填进来', () => {
  const r = normalizeActivities({ activities: [{ type: '跑步', calories: 300, distanceKm: 5000 }] });
  assert.equal(r.activities[0].distanceM, undefined, '5000 公里不是人跑的,宁可丢掉');
  assert.equal(normalizeActivities({ activities: [{ calories: 300, distanceKm: 500 }] }).activities[0].distanceM, 500_000,
    '500 公里在上限内,收');
  assert.equal(normalizeActivities({ activities: [{ calories: 300, distanceKm: -5 }] }).activities[0].distanceM, undefined);
  assert.equal(normalizeActivities({ activities: [{ calories: 300, distanceKm: 0 }] }).activities[0].distanceM, undefined);
  assert.equal(normalizeActivities({ activities: [{ calories: 300, distanceKm: '五公里' }] }).activities[0].distanceM, undefined,
    '中文数字它猜不出来,那就别要');
});

test('坡度超过 40% 丢掉,负数丢掉', () => {
  assert.equal(normalizeActivities({ activities: [{ calories: 1, inclinePct: 45 }] }).activities[0].inclinePct, undefined);
  assert.equal(normalizeActivities({ activities: [{ calories: 1, inclinePct: -3 }] }).activities[0].inclinePct, undefined);
  assert.equal(normalizeActivities({ activities: [{ calories: 1, inclinePct: 0 }] }).activities[0].inclinePct, undefined,
    '0 和「没说」是一回事,不存');
  assert.equal(normalizeActivities({ activities: [{ calories: 1, inclinePct: 12 }] }).activities[0].inclinePct, 12);
});

test('空串时间戳要当成没给 —— 否则客户端不会补,整条记录都建不进去', () => {
  const r = normalizeActivities({ activities: [{ type: '跑步', calories: 300, startedAt: '' }] });
  assert.equal(r.activities[0].startedAt, undefined);
  assert.equal(normalizeActivities({ activities: [{ calories: 1, startedAt: '昨天下午' }] }).activities[0].startedAt, undefined);
  const ok = normalizeActivities({ activities: [{ calories: 1, startedAt: '2026-10-15T07:30:00.000Z' }] });
  assert.equal(ok.activities[0].startedAt, '2026-10-15T07:30:00.000Z');
});

test('一天不可能练 25 小时:离谱时长丢掉,热量退回 0', () => {
  const r = normalizeActivities({ activities: [{ type: '跑步', durationMin: 1500, calories: 300 }] });
  assert.equal(r.activities[0].durationMin, undefined);
  const r2 = normalizeActivities({ activities: [{ type: '跑步', durationMin: 30, calories: 999_999 }] });
  assert.equal(r2.activities[0].calories, 0, '热量字段是必填的,给不了就 0 而不是编一个');
  assert.equal(normalizeActivities({ activities: [{ durationMin: 30 }] }).activities[0].calories, 0);
});

test('模型忘了 activities、返回 null、返回一堆非对象,都不能把接口打挂', () => {
  for (const bad of [undefined, null, {}, { activities: null }, { activities: '跑步半小时' }, { activities: [null, 3, 'x'] }]) {
    const r = normalizeActivities(bad as never);
    assert.equal(Array.isArray(r.activities), true);
    assert.equal(r.activities.length, 0, `输入 ${JSON.stringify(bad)} 应当得到空列表`);
  }
});

test('confidence 被限制在 0-1,垃圾值归 0', () => {
  assert.equal(normalizeActivities({ confidence: 5 }).confidence, 1);
  assert.equal(normalizeActivities({ confidence: -2 }).confidence, 0);
  assert.equal(normalizeActivities({ confidence: '高' }).confidence, 0);
  assert.equal(normalizeActivities(undefined).confidence, 0);
});

test('类型名太长/不是字符串也要收住(zod 上限 30)', () => {
  const r = normalizeActivities({ activities: [{ type: '跑'.repeat(80), calories: 1 }] });
  assert.equal(r.activities[0].type.length, 30);
  assert.equal(normalizeActivities({ activities: [{ calories: 1 }] }).activities[0].type, '');
});

test('每条出去都能过 zod 那关(和 activity 路由同一套界限)', () => {
  const r = normalizeActivities({
    activities: [{ type: '跑步', durationMin: 30, calories: 300, distanceKm: 5.2, inclinePct: 6.3, startedAt: '2026-10-15T07:30:00.000Z' }]
  });
  const a = r.activities[0];
  assert.equal(Number.isInteger(a.distanceM), true);
  assert.equal(a.distanceM! > 0 && a.distanceM! <= 500_000, true);
  assert.equal(a.inclinePct! >= 0 && a.inclinePct! <= 40, true);
  assert.equal(Number.isInteger(a.calories) && a.calories >= 0 && a.calories <= 20_000, true);
});
