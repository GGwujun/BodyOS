import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocSchema, PushSchema, MediaSchema, planPush, oversized, type DocRow } from './training';

const at = (h: number) => `2026-10-15T0${h}:00:00.000Z`;

test('推送的文档必须带 kind/键/客户端时间', () => {
  assert.equal(DocSchema.safeParse({ kind: 'plan', docKey: 'main', clientUpdatedAt: at(1), payload: {} }).success, true);
  assert.equal(DocSchema.safeParse({ kind: '不认识的域', docKey: 'main', clientUpdatedAt: at(1), payload: {} }).success, false);
  assert.equal(DocSchema.safeParse({ kind: 'plan', docKey: '', clientUpdatedAt: at(1), payload: {} }).success, false);
  assert.equal(DocSchema.safeParse({ kind: 'plan', docKey: 'main', clientUpdatedAt: '昨天', payload: {} }).success, false);
  assert.equal(PushSchema.safeParse({ docs: [] }).success, false, '空推送没有意义');
  assert.equal(PushSchema.safeParse({ docs: [{ kind: 'logs', docKey: 'wo-1', clientUpdatedAt: at(1), payload: { id: 'wo-1' } }] }).success, true);
  assert.equal(PushSchema.safeParse({ docs: new Array(501).fill({ kind: 'logs', docKey: 'x', clientUpdatedAt: at(1), payload: {} }) }).success, false, '一次推太多要拦住');
});

test('客户端用到的每一个域服务端都收(漏一个 = 那一类数据静默同步不上去)', () => {
  // 新增一类数据时漏改服务端 KINDS 的后果**不是报错**,而是那个域每次推送都被 400 退回来 ——
  // 用户看到的是「同步没报错,但另一台就是没有」。
  //
  // 所以这份清单**不能手写**:手写的话,漏改的正是这个测试自己(它列的还是老的那几项,
  // 于是照样全绿)。这里直接从客户端的 `MarkKind` 联合类型里抠出来当唯一出处。
  const src = readFileSync(join(__dirname, '../../../app/src/utils/sync-marks.ts'), 'utf8');
  const union = src.match(/export type MarkKind =([\s\S]*?);/)?.[1];
  assert.ok(union, '没读到客户端的 MarkKind —— 路径或写法变了,先修这个测试');
  const kinds = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 11, `只解析出 ${kinds.length} 个域,解析多半坏了`);
  for (const kind of kinds) {
    assert.equal(
      DocSchema.safeParse({ kind, docKey: 'main', clientUpdatedAt: at(1), payload: {} }).success,
      true, `服务端不认这个域:${kind}`
    );
  }
});

test('单条文档太大直接退回,不让它把库和响应都撑大', () => {
  assert.equal(oversized({ note: 'x'.repeat(1000) }), false);
  assert.equal(oversized({ note: '中'.repeat(30000) }), true, '中文按字节算,不是按字符算');
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  assert.equal(oversized(loop), true, '序列化不了的当超限处理');
});

test('新文档落库,服务端已有的原样保留给客户端', () => {
  const server: DocRow[] = [
    { kind: 'plan', docKey: 'main', payload: { old: true }, rev: 3, clientUpdatedAt: at(5) }
  ];
  const { creates, updates, result } = planPush(server, [
    { kind: 'logs', docKey: 'wo-1', payload: { id: 'wo-1' }, clientUpdatedAt: at(1) }
  ]);
  assert.equal(creates.length, 1);
  assert.equal(updates.length, 0);
  assert.deepEqual(result, [{ kind: 'logs', docKey: 'wo-1', payload: { id: 'wo-1' }, rev: 1, clientUpdatedAt: at(1) }]);
});

test('两端同一文档:后改的赢,不是后同步的赢', () => {
  const server: DocRow[] = [
    { kind: 'plan', docKey: 'main', payload: { from: 'server' }, rev: 2, clientUpdatedAt: at(6) }
  ];
  // 本机那份更早改的 → 不能覆盖云端(否则慢的设备一开机就把新的抹了)
  const older = planPush(server, [
    { kind: 'plan', docKey: 'main', payload: { from: 'phone' }, clientUpdatedAt: at(3) }
  ]);
  assert.equal(older.updates.length, 0);
  assert.deepEqual(older.result[0].payload, { from: 'server' }, '客户端拿到服务端那份,自己改成一致');
  assert.equal(older.result[0].rev, 2, '保留不动 rev 不该涨');

  // 本机那份更晚改的 → 覆盖云端,rev +1
  const newer = planPush(server, [
    { kind: 'plan', docKey: 'main', payload: { from: 'phone' }, clientUpdatedAt: at(9) }
  ]);
  assert.equal(newer.updates.length, 1);
  assert.deepEqual(newer.result[0].payload, { from: 'phone' });
  assert.equal(newer.result[0].rev, 3);
});

test('时间戳一样时以服务端为准(反复同步要收敛,不能来回翻)', () => {
  const server: DocRow[] = [
    { kind: 'kit', docKey: 'main', payload: { plates: 2 }, rev: 1, clientUpdatedAt: at(4) }
  ];
  const same = planPush(server, [
    { kind: 'kit', docKey: 'main', payload: { plates: 9 }, clientUpdatedAt: at(4) }
  ]);
  assert.equal(same.updates.length, 0);
  assert.deepEqual(same.result[0].payload, { plates: 2 });
  // 再同步一次还是同一个结果 —— 收敛
  const again = planPush(server, [
    { kind: 'kit', docKey: 'main', payload: { plates: 2 }, clientUpdatedAt: at(4) }
  ]);
  assert.equal(again.updates.length, 0);
  assert.deepEqual(again.result[0].payload, { plates: 2 });
});

test('同一次推送里既有新建也有覆盖,结果整份回传够客户端对齐', () => {
  const server: DocRow[] = [
    { kind: 'logs', docKey: 'wo-1', payload: { id: 'wo-1', v: 1 }, rev: 1, clientUpdatedAt: at(2) }
  ];
  const { creates, updates, result } = planPush(server, [
    { kind: 'logs', docKey: 'wo-1', payload: { id: 'wo-1', v: 2 }, clientUpdatedAt: at(7) },
    { kind: 'logs', docKey: 'wo-2', payload: { id: 'wo-2' }, clientUpdatedAt: at(1) }
  ]);
  assert.equal(updates.length, 1);
  assert.equal(creates.length, 1);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((d) => d.docKey).sort(), ['wo-1', 'wo-2']);
});

test('图片:裸 base64 也收,但不认识的格式和空数据要挡住', () => {
  assert.equal(MediaSchema.safeParse({ data: 'AAAA' }).success, true);
  assert.equal(MediaSchema.safeParse({ data: '' }).success, false);
  // 走路由层的格式判断,这里只确认 schema 不会把 mime 卡死(客户端可能带也可能不带)
  assert.equal(MediaSchema.safeParse({ data: 'AAAA', mime: 'image/png' }).success, true);
});
