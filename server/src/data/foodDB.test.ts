import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFood } from './foodDB';

/**
 * 别名放得太宽会「抢词」:输入草莓命中蓝莓、油条命中食用油,
 * 用户看到的是热量差好几倍的一条记录,而且没有任何报错。
 */
test('相近的食物名不能互相抢词', () => {
  assert.equal(matchFood('草莓')?.entry.name, '草莓');
  assert.equal(matchFood('蓝莓')?.entry.name, '蓝莓');
  assert.equal(matchFood('油条')?.entry.name, '油条');
  assert.equal(matchFood('油条')?.entry.kcal, 388);
  assert.equal(matchFood('橄榄油')?.entry.name, '橄榄油');
  // 口语别名仍然要能落到正确条目上
  assert.equal(matchFood('食用油')?.entry.name, '橄榄油');
  assert.equal(matchFood('浆果')?.entry.name, '蓝莓');
});
