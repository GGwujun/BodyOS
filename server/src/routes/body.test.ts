import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import bodyRouter from './body';
import { prisma } from '../db';

test('measurement writes start in a transaction and forward failure without reporting success', async () => {
  const failure = new Error('stop before database write');
  let atomic = false;
  prisma.$use(async params => {
    if (params.model === 'BodyMeasurement' && params.action === 'create') {
      atomic = params.runInTransaction;
    }
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
