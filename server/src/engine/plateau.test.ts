import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlateau } from './plateau';
import { addDays } from '../lib/date';

const TODAY = '2026-10-22';

/** 从今天往回铺 N 天,按给定的每日偏移取称重点 */
const at = (offsets: number[], kg: (offset: number) => number) =>
  offsets.map((o) => ({ date: addDays(TODAY, -o), weightKg: kg(o) }));

test('detectPlateau flags a genuine three-week stall', () => {
  const w = at([20, 15, 10, 5, 1], (o) => 70 + 0.01 * o); // 三周只涨了 0.2kg
  const r = detectPlateau(w, 'fat_loss', TODAY);
  assert.ok(r);
  assert.equal(r.days, 19);
  assert.equal(r.records, 5);
  assert.ok(Math.abs(r.changeKg) < 0.5);
});

test('detectPlateau stays silent while weight is actually moving', () => {
  const dropping = at([20, 15, 10, 5, 1], (o) => 70 - 0.1 * (20 - o)); // 三周 -2kg
  assert.equal(detectPlateau(dropping, 'fat_loss', TODAY), null);
  const rising = at([20, 15, 10, 5, 1], (o) => 70 + 0.1 * (20 - o)); // 三周 +2kg
  assert.equal(detectPlateau(rising, 'muscle_gain', TODAY), null);
});

test('off-direction movement is not a plateau either', () => {
  const gaining = at([20, 15, 10, 5, 1], (o) => 70 + 0.15 * (20 - o)); // 减脂目标却在涨
  assert.equal(detectPlateau(gaining, 'fat_loss', TODAY), null);
});

test('detectPlateau requires a weight-directed goal', () => {
  const stalled = at([20, 15, 10, 5, 1], () => 70);
  assert.equal(detectPlateau(stalled, null, TODAY), null);
  assert.equal(detectPlateau(stalled, 'maintain', TODAY), null); // 维持:不变就是达成
  assert.equal(detectPlateau(stalled, 'endurance', TODAY), null); // 耐力目标不看体重
  assert.ok(detectPlateau(stalled, 'fat_loss', TODAY)); // 对照组:减脂下同一条数据要报
});

test('detectPlateau needs enough weigh-ins spread over the window', () => {
  const stalled = at([20, 15, 10, 5, 1], () => 70);
  assert.equal(detectPlateau(stalled.slice(0, 3), 'fat_loss', TODAY), null); // 不足 4 次
  const crowded = at([3, 2, 1, 0], () => 70); // 4 次都挤在 4 天里
  assert.equal(detectPlateau(crowded, 'fat_loss', TODAY), null);
});

test('detectPlateau ignores stale tracking', () => {
  // 最后一次称重是 10 天前:人已经没在称了,不替他说「卡住了」
  const stale = at([29, 25, 21, 15, 10], () => 70);
  assert.equal(detectPlateau(stale, 'fat_loss', TODAY), null);
});

test('detectPlateau only reads the last 21 days', () => {
  // 更早的历史掉秤再猛也不影响:平台看的是「现在」有没有在动
  const w = [
    ...at([60, 50, 40, 30], (o) => 80 - 0.3 * (60 - o)), // 两月前一路掉
    ...at([20, 15, 10, 5, 1], () => 70) // 最近三周纹丝不动
  ];
  const r = detectPlateau(w, 'fat_loss', TODAY);
  assert.ok(r);
});
