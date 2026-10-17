import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, RequestHandler } from 'express';
import bodyRouter, { CreateBodySchema } from './body';
import { prisma } from '../db';

/**
 * 体重与档案的联动 —— 这几条错了不会报错,只会让首页的 TDEE/目标进度
 * 悄悄按一个已经不存在的体重算:
 *   ① 补录旧称重不许把档案改老(时间倒流);
 *   ② 删掉最新一次称重,档案要跟到剩下那条,不能原地复活;
 *   ③ 70 看成 700 这类手滑要当场挡住。
 */

interface Call { model?: string; action: string; args: Record<string, unknown> }
type Handler = (call: Call) => { hit: true; value: unknown } | { hit: false; error?: unknown };

let handle: Handler = () => ({ hit: false });
let seen: Call[] = [];
prisma.$use(async (params, next) => {
  const call = params as unknown as Call;
  seen.push(call);
  const r = handle(call);
  if (r.hit) return r.value as never;
  if (r.error) throw r.error;
  return next(params);
});

const callsOf = (model: string, action: string) =>
  seen.filter((c) => c.model === model && c.action === action);
const use = (h: Handler) => { handle = h; seen = []; };

function routeOf(method: 'post' | 'delete'): RequestHandler {
  const route = bodyRouter.stack.find(layer =>
    (layer.route as { methods?: Record<string, boolean> } | undefined)?.methods?.[method])?.route;
  assert.ok(route, `没有找到 ${method} 路由`);
  return route.stack[0].handle as RequestHandler;
}

async function drive(handler: RequestHandler, req: Partial<Request>): Promise<{ forwarded?: unknown; body?: unknown }> {
  let settle!: (v: { forwarded?: unknown; body?: unknown }) => void;
  const done = new Promise<{ forwarded?: unknown; body?: unknown }>((resolve) => { settle = resolve; });
  const res = {
    locals: { userId: 'u_1' },
    status() { return this; },
    json(body: unknown) { settle({ body }); return this; }
  } as unknown as Response;
  handler(req as Request, res, (error?: unknown) => settle({ forwarded: error }));
  return Promise.race([
    done,
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error('路由超时')), 3000);
      (t as unknown as { unref?: () => void }).unref?.();
    })
  ]);
}

test('体重范围挡住手滑,边界值仍然可用', () => {
  const at = '2026-01-01T00:00:00.000Z';
  for (const weightKg of [10, 19.9, 400.1, 700, NaN, Infinity]) {
    assert.equal(CreateBodySchema.safeParse({ measuredAt: at, weightKg }).success, false, `${weightKg} 不该收`);
  }
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, weightKg: 20 }).success, true);
  assert.equal(CreateBodySchema.safeParse({ measuredAt: at, weightKg: 400 }).success, true);
});

test('补录一条旧称重不会把档案体重改回过去的值', async () => {
  use((call) => {
    if (call.model === 'BodyMeasurement' && call.action === 'findFirst') {
      // 本机最新一条是 1 月 10 号
      return { hit: true, value: { measuredAt: new Date('2020-01-10T00:00:00.000Z') } };
    }
    if (call.model === 'BodyMeasurement' && call.action === 'create') return { hit: true, value: { id: 'm-old' } };
    if (call.model === 'UserProfile' && call.action === 'upsert') return { hit: true, value: {} };
    return { hit: false };
  });

  const r = await drive(routeOf('post'), {
    body: { measuredAt: '2020-01-01T00:00:00.000Z', weightKg: 90 }
  });

  assert.ok(!r.forwarded, `路由不该报错: ${String(r.forwarded)}`);
  assert.equal(callsOf('BodyMeasurement', 'create').length, 1, '称重本身要落库');
  assert.equal(callsOf('UserProfile', 'upsert').length, 0, '旧称重不许回写档案');
});

test('删掉最新称重后,档案跟着剩下那条走', async () => {
  use((call) => {
    if (call.model === 'BodyMeasurement' && call.action === 'findUnique') {
      return { hit: true, value: { id: 'm2', userId: 'u_1', weightKg: 70, measuredAt: new Date('2030-01-02T00:00:00.000Z') } };
    }
    if (call.model === 'BodyMeasurement' && call.action === 'delete') return { hit: true, value: {} };
    if (call.model === 'BodyMeasurement' && call.action === 'findFirst') {
      return { hit: true, value: { weightKg: 68 } };
    }
    if (call.model === 'UserProfile' && call.action === 'findUnique') {
      return { hit: true, value: { userId: 'u_1', weightKg: 70 } };
    }
    if (call.model === 'UserProfile' && call.action === 'update') return { hit: true, value: {} };
    return { hit: false };
  });

  const r = await drive(routeOf('delete'), { params: { id: 'm2' } });

  assert.ok(!r.forwarded, `路由不该报错: ${String(r.forwarded)}`);
  const updates = callsOf('UserProfile', 'update');
  assert.equal(updates.length, 1, '档案要改成剩下那条的体重');
  assert.equal((updates[0].args.data as { weightKg: number }).weightKg, 68);
});

test('删掉唯一一条称重且档案正好是它 → 档案清空,不是留一个幽灵体重', async () => {
  use((call) => {
    if (call.model === 'BodyMeasurement' && call.action === 'findUnique') {
      return { hit: true, value: { id: 'm1', userId: 'u_1', weightKg: 70, measuredAt: new Date('2030-01-03T00:00:00.000Z') } };
    }
    if (call.model === 'BodyMeasurement' && call.action === 'delete') return { hit: true, value: {} };
    if (call.model === 'BodyMeasurement' && call.action === 'findFirst') return { hit: true, value: null };
    if (call.model === 'UserProfile' && call.action === 'findUnique') {
      return { hit: true, value: { userId: 'u_1', weightKg: 70 } };
    }
    if (call.model === 'UserProfile' && call.action === 'update') return { hit: true, value: {} };
    return { hit: false };
  });

  const r = await drive(routeOf('delete'), { params: { id: 'm1' } });

  assert.ok(!r.forwarded, `路由不该报错: ${String(r.forwarded)}`);
  const updates = callsOf('UserProfile', 'update');
  assert.equal(updates.length, 1);
  assert.equal((updates[0].args.data as { weightKg: number | null }).weightKg, null);
});
