/**
 * 挂载表测试 —— 「客户端会打的每一条路,服务端都真的接得住」。
 *
 * 为什么值得单独一个文件:`routes/index.ts` 里各路由的挂载顺序是有讲究的
 * (`/training` 在 `/training/reminder` 之前,靠「不匹配就继续往下走」命中更具体那条),
 * 而这类错误的表现是**静默的** —— 顺序错了不会报错,只会 404/不响应,于是
 * 「提醒设置保存不了」「照片传不上去」这种问题要等用户反馈才会被发现。
 *
 * 这里的请求**一律用非法 body**,理由是那些 schema 校验都发生在碰数据库之前:
 * 断言拿到 400 就说明「确实走到了那个路由体里」,同时不需要数据库、不需要桩。
 * 配一条负向对照(不存在的路径必须**没人接**),否则整个文件可能因为「什么都接」
 * 而永远通过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import routes from './index';

/** 手动把请求喂给组合后的 router,拿到「谁回了什么」;没人接时 next() 被调用 */
async function send(
  method: string,
  url: string,
  body: unknown,
  timeoutMs = 3000
): Promise<{ status?: number; body?: unknown; handled: boolean }> {
  let settle!: (v: { status?: number; body?: unknown; handled: boolean }) => void;
  const done = new Promise<{ status?: number; body?: unknown; handled: boolean }>((r) => { settle = r; });
  const req = { method, url, headers: {}, body } as unknown as Request;
  let statusCode = 200;
  const res = {
    locals: {},
    status(code: number) { statusCode = code; return res; },
    json(payload: unknown) { settle({ status: statusCode, body: payload, handled: true }); return res; }
  } as unknown as Response;
  // 组合 router 是 (req, res, next) 形态;没人匹配时它就是那个 next 被调到的地方
  (routes as unknown as (q: Request, s: Response, n: NextFunction) => void)(req, res, () => {
    settle({ handled: false });
  });
  return Promise.race([
    done,
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${method} ${url} 3 秒内既没响应也没放行`)), timeoutMs);
      (t as unknown as { unref?: () => void }).unref?.();
    })
  ]);
}

const messageOf = (r: { body?: unknown }) => ((r.body as { message?: string } | undefined)?.message ?? '');

test('训练数据域:推文档 / 传照片 / 提醒设置 / 授权额度,每一条都真的接得住', async () => {
  const cases: Array<[string, string, unknown, string]> = [
    ['PUT', '/training/docs', { docs: [] }, '空推送'],
    ['POST', '/training/media', {}, '缺图片'],
    ['PUT', '/training/reminder', { enabled: '是' }, '提醒设置'],
    ['POST', '/training/reminder/grant', { accepted: -1 }, '授权额度']
  ];
  for (const [method, url, body, what] of cases) {
    const r = await send(method, url, body);
    assert.equal(r.handled, true, `${what} 这条路没人接(${method} ${url})`);
    assert.equal(r.status, 400, `${what} 该被参数校验挡下(${method} ${url})`);
    assert.ok(messageOf(r).length > 0, `${what} 的 400 要带一句人话`);
  }
});

test('提醒路由挂在 /training 之后仍然可达(顺序改了就等于静默废掉提醒)', async () => {
  // `/training` 是个前缀路由,它自己只有 /docs 与 /media;`/training/reminder` 靠
  // 「/training 那条不匹配 → 继续往下走到提醒路由」命中。谁要是把挂载顺序调一下,
  // 或者给 /training 加一条 catch-all,提醒就整块失效 —— 而且不报错。
  const put = await send('PUT', '/training/reminder', { enabled: true, time: '8:00', tone: 'gentle', nudge: true, tzOffsetMin: 480 });
  assert.equal(put.handled, true, '/training/reminder 没能走到提醒路由');
  // 时间写成「8:00」而规则要求补零 → 这条 400 只可能来自 ReminderSchema
  assert.equal(put.status, 400);
  assert.match(messageOf(put), /HH:mm/, '回话要来自提醒路由自己的校验');

  const grant = await send('POST', '/training/reminder/grant', { accepted: 999 });
  assert.equal(grant.handled, true, '/training/reminder/grant 没能走到提醒路由');
  assert.equal(grant.status, 400);
});

test('负向对照:不存在的路径必须没人接(否则上面几条可能是假通过)', async () => {
  const r = await send('PUT', '/training/__这个路径不存在', {});
  assert.equal(r.handled, false, '没这条路由就应该是「没人接」,而不是有谁回了个什么');
});
