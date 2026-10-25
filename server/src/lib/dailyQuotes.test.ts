import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUOTES, dayIndexOf, pickQuoteIndex, validateQuoteList } from './dailyQuotes';

/**
 * 金句轮换是「全站当天同一条」的口径,确定性就是一切:
 * 同一天必须同一条、相邻日期要轮动、库长变了索引必须仍落回区间。
 * 客户端(src/constants/dailyQuotes.ts)复制了同一套公式,这里的用例就是两边的契约。
 */

test('同一天全站同一条,相邻日期轮动', () => {
  assert.equal(pickQuoteIndex('2026-10-25', 30), pickQuoteIndex('2026-10-25', 30));
  const a = pickQuoteIndex('2026-10-24', 30);
  const b = pickQuoteIndex('2026-10-25', 30);
  const c = pickQuoteIndex('2026-10-26', 30);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  // 差 N 天索引就差 N(取模前):轮换顺序稳定可复算
  assert.equal((b - a + 30) % 30, 1);
  assert.equal((c - a + 30) % 30, 2);
});

test('索引永远落在库区间内,换库长也不越界', () => {
  for (const count of [1, 7, 30, 200]) {
    assert.ok(pickQuoteIndex('2026-10-25', count) >= 0);
    assert.ok(pickQuoteIndex('2026-10-25', count) < count);
  }
  // 锚点日当天是第 0 条;锚点日之后取值单调
  assert.equal(pickQuoteIndex('2026-01-01', 30), 0);
  assert.equal(dayIndexOf('2026-01-02') - dayIndexOf('2026-01-01'), 1);
});

test('日期差算的是自然日,不是 24 小时块', () => {
  // 1 月 31 日 → 2 月 1 日只该差 1 天(月边界),不取决于时刻
  assert.equal(dayIndexOf('2026-02-01') - dayIndexOf('2026-01-31'), 1);
  assert.equal(dayIndexOf('2026-12-31') - dayIndexOf('2026-01-01'), 364);
});

test('默认库 30 条,全部通过自身校验,主句无重复', () => {
  assert.equal(DEFAULT_QUOTES.length, 30);
  const { quotes, error } = validateQuoteList(DEFAULT_QUOTES);
  assert.equal(error, undefined);
  assert.equal(quotes.length, 30);
  assert.equal(new Set(DEFAULT_QUOTES.map((q) => q.text)).size, 30);
});

test('校验:长度越界 / 空库 / 重复主句去重', () => {
  assert.ok(validateQuoteList([]).error);
  assert.ok(validateQuoteList([{ text: '太短', sub: '也短', category: 'x' }]).error?.includes('主句'));
  assert.ok(validateQuoteList([{ text: '这是一句长度刚好四十字度量的主句没问题吧', sub: '出路句', category: 'x' }]).quotes.length === 1);
  const dup = validateQuoteList([
    { text: '重复的主句重复的主句重复的主句重复的主句', sub: '出路一', category: 'x' },
    { text: '重复的主句重复的主句重复的主句重复的主句', sub: '出路二', category: 'x' }
  ]);
  assert.equal(dup.error, undefined);
  assert.equal(dup.quotes.length, 1);
  assert.equal(dup.quotes[0].sub, '出路一');
});
