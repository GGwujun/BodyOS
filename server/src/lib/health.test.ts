import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthCheck } from './health';

test('两件事都通 → ok,探针文件不残留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bodyos-health-'));
  try {
    const r = await healthCheck(dir, async () => 'fine');
    assert.deepEqual(r, { ok: true });
    // 探针文件写完就删 —— 留在媒体目录里的话,每个健康周期都会多一个脏文件
    const left = await readdir(dir);
    assert.deepEqual(left, [], `探针残留: ${left.join(',')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('数据库查不动 → 不健康(why: db),而且不去碰媒体目录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bodyos-health-'));
  try {
    const r = await healthCheck(dir, async () => { throw new Error('connection refused'); });
    assert.deepEqual(r, { ok: false, why: 'db' });
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('媒体目录写不进 → 不健康(why: media)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bodyos-health-'));
  try {
    // 路径的一段是个普通文件:mkdir -p 走到它就断 —— 只读卷/挂载错位在容器里的样子
    const blocker = join(dir, 'i-am-a-file');
    await writeFile(blocker, 'x');
    const r = await healthCheck(join(blocker, 'media'), async () => 'fine');
    assert.deepEqual(r, { ok: false, why: 'media' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('目录还不存在 → 先建再验,照样健康(容器首启卷是空的不是坏的)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bodyos-health-'));
  try {
    const nested = join(root, 'media', 'deep');
    const r = await healthCheck(nested, async () => 'fine');
    assert.deepEqual(r, { ok: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
