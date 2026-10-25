import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import bodyRouter, { CreateBodySchema } from './body';
import { prisma } from '../db';

test('只量围度也能存,量错一位数会被挡', () => {
  const at = '2026-01-01T00:00:00.000Z';
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, waistCm: 80 }).success, true);
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, waistCm: 800 }).success, false);
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, waistCm: 5 }).success, false);
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at }).success, false, '什么都没填要拦住');
});

test('自建部位(extras):键值同围度规则,只填自建部位也能存', () => {
  const at = '2026-01-01T00:00:00.000Z';
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, extras: { 'x-ab12cd': 36.5 } }).success, true);
  // 值同围度规则:量错一位数挡掉
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, extras: { 'x-ab12cd': 360 } }).success, false);
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, extras: { 'x-ab12cd': 5 } }).success, false);
  // 键必须 x- 开头(客户端自建部位的形状),乱写的键不收
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, extras: { waistCm: 80 } }).success, false);
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, extras: { 'X-ab12cd': 36.5 } }).success, false);
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, extras: { 'x-AB': 36.5 } }).success, false);
  // 空对象不算「填了」
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, extras: {} }).success, false);
  // 条数有上限(客户端自建部位上限 12,这里放点余量到 16)
  const tooMany = Object.fromEntries(
    Array.from({ length: 17 }, (_, i) => [`x-a${String(i).padStart(5, '0')}`, 36.5])
  );
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, extras: tooMany }).success, false);
});

test('measurement writes start in a transaction and forward failure without reporting success', async () => {
  const failure = new Error('stop before database write');
  let atomic = false;
  prisma.$use(async params => {
    if (params.model === 'BodyMeasurement' && params.action === 'create') {
      atomic = params.runInTransaction;
    }
    // 写入前要读一次「当前最新体重」决定是否同步档案 —— 那是正常的读,放它过去
    if (params.model === 'BodyMeasurement' && params.action === 'findFirst') return null;
    throw failure;
  });
  const route = bodyRouter.stack.find(layer => (layer.route as {methods?:{post?:boolean}} | undefined)?.methods?.post)?.route;
  assert.ok(route);
  let forwarded: unknown;
  await assert.doesNotReject(async () => {
    await route.stack[0].handle({body:{measuredAt:'2026-01-01T00:00:00.000Z',weightKg:70}} as Request,
      {json(){assert.fail('Failed writes cannot return success')}} as unknown as Response,
      (error: unknown)=>{forwarded=error});
  });
  assert.equal(atomic,true,'Measurement creation must participate in the profile transaction');
  assert.equal(forwarded,failure);
});

test('measurement listing and deletion forward database errors to Express', async () => {
  prisma.$use(async () => { throw new Error('stop before database access'); });
  for (const method of ['get', 'delete']) {
    const route = bodyRouter.stack.find(layer =>
      (layer.route as {methods?:Record<string,boolean>} | undefined)?.methods?.[method])?.route;
    assert.ok(route);
    let forwarded: unknown;
    await assert.doesNotReject(async () => {
      await route.stack[0].handle({query:{},params:{id:'not-a-real-record'}} as unknown as Request,
        {json(){assert.fail('Database failure cannot return success')}} as unknown as Response,
        (error: unknown)=>{forwarded=error});
    });
    assert.ok(forwarded instanceof Error);
  }
});
