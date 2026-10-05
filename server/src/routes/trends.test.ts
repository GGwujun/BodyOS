import test from 'node:test';
import assert from 'node:assert/strict';
import trendsRouter from './trends';
import { prisma } from '../db';
import type { Request, Response } from 'express';

test('trend database failures reach the error handler instead of escaping the request', async () => {
  const failure = new Error('injected database outage');
  const queries: string[] = [];
  // Fail before database access: no fixtures are persisted and no database is required.
  prisma.$use(async (params) => {
    queries.push(`${params.model}.${params.action}`);
    throw failure;
  });
  const route = trendsRouter.stack.find(layer => layer.route?.path === '/')?.route;
  assert.ok(route);
  const handler = route.stack[0].handle;
  let forwarded: unknown;
  await assert.doesNotReject(async () => {
    await handler({ query: { range: '7' } } as unknown as Request, {
      json() { assert.fail('A failed refresh must not return successful statistics'); }
    } as unknown as Response, (error: unknown) => { forwarded = error; });
  });
  assert.equal(forwarded, failure);
  assert.equal(queries.includes('DailySummary.findMany'), false,
    'Failed recomputation must stop before querying potentially stale summaries');
});
