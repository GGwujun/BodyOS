import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceStatusLabel } from '../src/utils/sourceStatus';

test('connected sources without a successful sync do not claim synchronization',()=>{
  assert.equal(sourceStatusLabel('connected'), '已连接，尚未同步');
});
test('source status preserves failures and progress rather than reporting disconnected',()=>{
  assert.equal(sourceStatusLabel('syncing'), '正在同步');
  assert.equal(sourceStatusLabel('error'), '同步异常');
  assert.equal(sourceStatusLabel('disconnected'), '尚未连接');
});
test('successful sync reports its timestamp instead of claiming it happened today',()=>{
  assert.match(sourceStatusLabel('synced','2020-01-02T12:30:00.000Z'), /2020/);
  assert.equal(sourceStatusLabel('synced','not-a-date'),'已连接，同步时间未知');
});
