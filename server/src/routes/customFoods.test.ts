import test from 'node:test';
import assert from 'node:assert/strict';
import customFoodsRouter from './customFoods';
import { prisma } from '../db';
import type { Request, Response } from 'express';

/**
 * 路由级单测:不起 HTTP,直接调 wrap 里的 handler。
 * Prisma 用 $use 拦截 —— 只在本文件激活(active 标记),跑完关掉,
 * 不影响同进程里其他测试文件的真库访问。
 */
let active = false;
let upsertArgs: unknown = null;
const reply: { findMany: unknown; upsert: unknown } = { findMany: [], upsert: {} };
prisma.$use(async (params, next) => {
  if (active && params.model === 'CustomFood') {
    if (params.action === 'upsert') { upsertArgs = params.args; return reply.upsert; }
    if (params.action === 'findMany') return reply.findMany;
  }
  return next(params);
});

function handlerOf(path: string, method: 'get' | 'post' | 'delete') {
  // 同一路径 GET/POST 各是一层;express 的类型没声明 methods(运行时在),断言着挑
  const route = customFoodsRouter.stack.find((layer) => {
    const r = layer.route as unknown as { path?: string; methods?: Record<string, boolean> } | undefined;
    return r?.path === path && !!r.methods?.[method];
  })?.route;
  assert.ok(route, `${method} ${path} not registered`);
  return route.stack[0].handle as (req: Request, res: Response) => Promise<unknown>;
}

function mockRes(userId = 'u1') {
  const out: { body: unknown; status: number } = { body: null, status: 0 };
  /**
   * wrap() 刻意不返回内部 promise(错误全走 next(err)),直接 await handler 等到的是 undefined,
   * 断言会比真 handler 先跑。这里改成等「响应真正写出」—— json 被调到才算完。
   */
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  const res = {
    locals: { userId },
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; settle(); return res; }
  };
  return { res: res as unknown as Response, out, settled };
}

test('custom foods: reject impossible nutrition values before touching the database', async () => {
  const handler = handlerOf('/', 'post');
  const { res, out, settled } = mockRes();
  await handler({ body: { name: '鸡胸肉', calories: -1 } } as unknown as Request, res);
  await settled;
  assert.equal(out.status, 400);
  assert.equal(upsertArgs, null);
});

test('custom foods: saving dedupes on user+name+amount so re-saving updates, not duplicates', async () => {
  active = true;
  try {
    const handler = handlerOf('/', 'post');
    const { res, out, settled } = mockRes();
    await handler({ body: { name: '鸡胸肉', amount: '150g', calories: 246, proteinG: 46 } } as unknown as Request, res);
    await settled;
    assert.equal(out.status, 0, 'success path never calls res.status');
    assert.equal((out.body as { code: number }).code, 0);
    const args = upsertArgs as { where: { userId_name_amount: Record<string, string> }; create: Record<string, unknown> };
    assert.deepEqual(args.where.userId_name_amount, { userId: 'u1', name: '鸡胸肉', amount: '150g' });
    assert.equal(args.create.calories, 246);
    assert.equal(args.create.proteinG, 46);
  } finally {
    active = false;
  }
});

test('custom foods: delete refuses rows belonging to someone else', async () => {
  active = true;
  const realFindUnique = prisma.customFood.findUnique;
  prisma.customFood.findUnique = (async () => ({ id: 'f1', userId: 'someone-else' })) as unknown as typeof realFindUnique;
  try {
    const handler = handlerOf('/:id', 'delete');
    const { res, out, settled } = mockRes();
    await handler({ params: { id: 'f1' } } as unknown as Request, res);
    await settled;
    assert.equal(out.status, 404);
    // 找不到也一样 404(不区分「不存在」和「不是你的」,不泄露别人的条目存在与否)
    prisma.customFood.findUnique = (async () => null) as unknown as typeof realFindUnique;
    const second = mockRes();
    await handler({ params: { id: 'nope' } } as unknown as Request, second.res);
    await second.settled;
    assert.equal(second.out.status, 404);
  } finally {
    prisma.customFood.findUnique = realFindUnique;
    active = false;
  }
});
