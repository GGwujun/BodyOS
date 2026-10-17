import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, RequestHandler } from 'express';
import activityRouter, { CreateActivitySchema } from './activity';
import { prisma } from '../db';

const at = '2026-10-15T12:00:00.000Z';
const base = { type: '跑步', startedAt: at, calories: 300 };

interface Call { model?: string; action: string; args: Record<string, unknown> }
type Decision =
  | { kind: 'next' }
  | { kind: 'throw'; error: Error }
  | { kind: 'return'; value: unknown };

/**
 * prisma.$use **没有注销接口**,而且中间件是层层叠加的(后注册的跑在前一个的 next() 之后)。
 * 每个 test 各注册一个的话,前一个 test 的中间件会继续截住后一个 test 的查询 ——
 * 表现是「明明设了新的桩,拿到的却是上一个 test 的东西」。所以全文件只注册一个,
 * 行为由一个每个 test 自己换的 `decide` 决定。用例串行执行,换 decide 是安全的。
 */
let decide: (call: Call) => Decision = () => ({ kind: 'next' });
let seen: Call[] = [];
prisma.$use(async (params, next) => {
  const call = params as unknown as Call;
  seen.push(call);
  const d = decide(call);
  if (d.kind === 'throw') throw d.error;
  if (d.kind === 'return') return d.value as never;
  return next(params);
});

const callsOf = (action: string) => seen.filter(c => c.action === action);
const reset = (d: (call: Call) => Decision) => { decide = d; seen = []; };

/**
 * 手动驱动一个路由 handler,拿到「它到底回了什么」。
 *
 * 不能只 `await handler(req, res)`:`wrap()` 返回的函数**不是 async** 也不返回内部 Promise
 * (它是 `(req,res,next) => { handler(req,res).catch(next) }`),直接 await 会在路由体
 * 执行之前就 resolve,断言看到的永远是 undefined。所以等真实信号:要么 res.json 了,
 * 要么 next(error) 了 —— 谁先来就是结果;再带个超时,免得 handler 卡住时测试挂死在 CI 上。
 */
async function drive(
  handler: RequestHandler,
  req: Partial<Request>,
  timeoutMs = 3000
): Promise<{ forwarded?: unknown; body?: unknown }> {
  let settle!: (v: { forwarded?: unknown; body?: unknown }) => void;
  const done = new Promise<{ forwarded?: unknown; body?: unknown }>((resolve) => { settle = resolve; });
  const res = {
    locals: {},
    status() { return this; },
    json(body: unknown) { settle({ body }); return this; }
  } as unknown as Response;
  handler(req as Request, res, (error?: unknown) => settle({ forwarded: error }));
  return Promise.race([
    done,
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`路由 ${timeoutMs}ms 内既没响应也没转错误`)), timeoutMs);
      (t as unknown as { unref?: () => void }).unref?.();  // 别拖着测试进程
    })
  ]);
}

function routeOf(method: 'get' | 'post' | 'put' | 'delete'): RequestHandler {
  const route = activityRouter.stack.find(layer =>
    (layer.route as { methods?: Record<string, boolean> } | undefined)?.methods?.[method])?.route;
  assert.ok(route, `没有找到 ${method} 路由`);
  return route.stack[0].handle as RequestHandler;
}

test('有氧的距离和坡度收得下,荒唐的值当场挡住', () => {
  assert.equal(CreateActivitySchema.safeParse({ ...base, distanceM: 5200, inclinePct: 6 }).success, true);
  assert.equal(CreateActivitySchema.safeParse({ ...base, distanceM: 75 * 1000 * 1000 }).success, false,
    '把体重(75)当公里填进去要拦住');
  assert.equal(CreateActivitySchema.safeParse({ ...base, distanceM: 0 }).success, false, '0 米不是一次跑步');
  assert.equal(CreateActivitySchema.safeParse({ ...base, distanceM: -100 }).success, false);
  assert.equal(CreateActivitySchema.safeParse({ ...base, distanceM: 1000.5 }).success, false, '距离精确到米,不收小数');
  assert.equal(CreateActivitySchema.safeParse({ ...base, inclinePct: 45 }).success, false, '坡度上限 40%(同 openGym)');
  assert.equal(CreateActivitySchema.safeParse({ ...base, inclinePct: 6.5 }).success, true, '跑步机有半格');
  assert.equal(CreateActivitySchema.safeParse({ ...base, inclinePct: -1 }).success, false);
  assert.equal(CreateActivitySchema.safeParse({ ...base }).success, true, '力量训练不填距离坡度照样能存');
});

test('距离和坡度可以显式清空(编辑时用户删掉了),而不是「没传」', () => {
  const parsed = CreateActivitySchema.partial().safeParse({ distanceM: null, inclinePct: null });
  assert.equal(parsed.success, true);
  // 用 nullish 而不是 optional:只认 optional 的话「清空」和「不改」在请求里长得一模一样,
  // 用户删掉的距离就永远删不掉了
  assert.equal(parsed.success && parsed.data.distanceM, null);
  assert.equal(parsed.success && parsed.data.inclinePct, null);
});

test('编辑写入的是用户传的那份值,provider/externalId 不许改', async () => {
  const failure = new Error('stop before database write');
  reset(call => {
    if (call.action === 'findUnique') {
      // 让流程走到 update:伪造一条属于开发用户(u_1)的记录
      return { kind: 'return', value: { id: 'a1', userId: 'u_1', date: new Date(at), startedAt: new Date(at) } };
    }
    if (call.action === 'update') return { kind: 'throw', error: failure };
    return { kind: 'next' };
  });

  const result = await drive(routeOf('put'), {
    params: { id: 'a1' },
    body: { distanceM: null, inclinePct: 6, provider: 'wechat', externalId: 'x1' }
  });

  assert.equal(result.forwarded, failure, '写失败必须交给 Express 错误处理,不能回成功');
  const writes = callsOf('update');
  assert.equal(writes.length, 1, '应当且只应当写一次');
  const data = writes[0].args.data as Record<string, unknown>;
  assert.equal(data.distanceM, null, '清空距离必须真的落成 null');
  assert.equal(data.inclinePct, 6);
  assert.equal('provider' in data, false, 'provider 不许改,否则会破坏去重幂等');
  assert.equal('externalId' in data, false);
});

test('新建一条跑步记录会把距离和坡度落库', async () => {
  reset(call => call.action === 'create' ? { kind: 'throw', error: new Error('captured') } : { kind: 'next' });

  await drive(routeOf('post'), { body: { ...base, distanceM: 5200, inclinePct: 6.5 } });

  const writes = callsOf('create');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args.data && (writes[0].args.data as Record<string, unknown>).distanceM, 5200);
  assert.equal((writes[0].args.data as Record<string, unknown>).inclinePct, 6.5);
});

test('不给距离和坡度时写 null,而不是留一个 undefined 混进 Prisma', async () => {
  reset(call => call.action === 'create' ? { kind: 'throw', error: new Error('captured') } : { kind: 'next' });

  await drive(routeOf('post'), { body: { ...base, type: '瑜伽' } });

  const data = callsOf('create')[0].args.data as Record<string, unknown>;
  assert.equal(data.distanceM, null);
  assert.equal(data.inclinePct, null);
});

test('列表查询出错要交给 Express 的错误处理,不能把失败当空列表返回', async () => {
  reset(() => ({ kind: 'throw', error: new Error('injected database outage') }));

  const result = await drive(routeOf('get'), { query: { date: '2026-10-15' } });

  assert.ok(result.forwarded instanceof Error);
  assert.equal(result.body, undefined, '数据库失败不能返回一份「今天没有运动」');
});

test('训练回写重试:同一个 externalId 即使没带 provider 也只更新,不再新建一条', async () => {
  reset(call => {
    if (call.model === 'ActivityRecord' && call.action === 'findFirst') {
      // 老版本写下的那条 provider 还是 NULL
      return { kind: 'return', value: { id: 'a-old', userId: 'u_1', date: new Date('2030-02-01T00:00:00') } };
    }
    if (call.model === 'ActivityRecord' && call.action === 'update') return { kind: 'return', value: { id: 'a-old' } };
    return { kind: 'next' };
  });

  const result = await drive(routeOf('post'), {
    body: {
      type: '力量训练', startedAt: '2030-02-01T12:00:00.000Z', calories: 200,
      durationMin: 45, source: 'training', externalId: 'wo-9'
    }
  });

  assert.equal(result.forwarded, undefined, '重试不是错误');
  assert.equal((result.body as { data?: { deduplicated?: boolean } }).data?.deduplicated, true);
  assert.equal(callsOf('create').length, 0, '不许再写一条重复的消耗');
  const update = callsOf('update').find(c => c.model === 'ActivityRecord')!;
  assert.ok(update, '应当更新那条已有记录');
  assert.equal((update.args.where as { id: string }).id, 'a-old');
  const data = update.args.data as Record<string, unknown>;
  assert.equal(data.provider, 'training', 'provider 要补成 source,唯一约束才真的生效');
  assert.equal(data.externalId, 'wo-9');
  assert.equal(data.deletedAt, null, '之前软删过的记录要被复活,不是留一条看不见的');
});

test('两条并发写撞上唯一约束:输掉的那条按已写入处理,不返回 500', async () => {
  let finds = 0;
  reset(call => {
    if (call.model === 'ActivityRecord' && call.action === 'findFirst') {
      // 第一次查不到(对方还没提交),create 撞唯一约束后再查就有了
      finds++;
      return { kind: 'return', value: finds === 1 ? null : { id: 'a-win', userId: 'u_1', date: new Date('2030-02-02T00:00:00') } };
    }
    if (call.model === 'ActivityRecord' && call.action === 'create') {
      return { kind: 'throw', error: Object.assign(new Error('unique'), { code: 'P2002' }) };
    }
    if (call.model === 'ActivityRecord' && call.action === 'update') return { kind: 'return', value: { id: 'a-win' } };
    return { kind: 'next' };
  });

  const result = await drive(routeOf('post'), {
    body: {
      type: '力量训练', startedAt: '2030-02-02T12:00:00.000Z', calories: 180,
      durationMin: 40, source: 'training', externalId: 'wo-10'
    }
  });

  assert.equal(result.forwarded, undefined, 'P2002 是「已经写过了」,不是服务器错误');
  assert.equal((result.body as { data?: { deduplicated?: boolean } }).data?.deduplicated, true);
  assert.equal(callsOf('update').filter(c => c.model === 'ActivityRecord').length, 1);
});
