/**
 * 每日分享卡 E2E(在生产的容器里跑:docker run --rm -i --network host --env-file /opt/bodyos/.env <img> node < 本文件)。
 * 覆盖:金句接口(首刷种库/同天同句/隔天换句/recordDays)、管理端(x-admin-key 列表 + 原样写回)、小程序码(生成 + 落盘)。
 */
const base = 'http://localhost:3000/api/v1';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { issueToken } = require('/app/dist/lib/currentUser.js');

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

(async () => {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user) { console.log('FAIL  生产库里没有用户,E2E 没法继续'); process.exit(1); }
  const token = await issueToken(user.id);
  const auth = { Authorization: `Bearer ${token}` };

  // —— 金句接口 ——
  const r1 = await fetch(`${base}/daily-quote?date=2026-10-25`, { headers: auth });
  const d1 = await r1.json();
  ok('GET /daily-quote 200', r1.status === 200, `status=${r1.status}`);
  const q = d1.data && d1.data.quote;
  ok('首刷种库后返回金句(text/sub)', q && q.text && q.sub, JSON.stringify(d1).slice(0, 160));
  ok('total = 30(默认库种齐)', d1.data && d1.data.total === 30, `total=${d1.data && d1.data.total}`);
  ok('recordDays ≥ 1(按注册日算)', d1.data && d1.data.recordDays >= 1, `recordDays=${d1.data && d1.data.recordDays}`);

  const d2 = await (await fetch(`${base}/daily-quote?date=2026-10-25`, { headers: auth })).json();
  ok('同一天两次取到同一句', d2.data.quote.text === q.text);

  const d3 = await (await fetch(`${base}/daily-quote?date=2026-10-26`, { headers: auth })).json();
  ok('第二天换一句(30 句轮换)', d3.data.quote.text !== q.text);

  const rb = await fetch(`${base}/daily-quote?date=2026-10-25`, { headers: { Authorization: 'Bearer bad-token' } });
  ok('无有效登录 = 401', rb.status === 401, `status=${rb.status}`);

  // —— 管理端 ——
  const key = process.env.ADMIN_API_KEY;
  const headers = { 'x-admin-key': key, 'content-type': 'application/json' };
  const ra = await fetch(`${base}/daily-quote/admin`, { headers });
  const da = await ra.json();
  ok('admin 列表 200 且 30 条', ra.status === 200 && Array.isArray(da.data) && da.data.length === 30, `n=${da.data && da.data.length}`);

  const rp = await fetch(`${base}/daily-quote`, {
    method: 'PUT', headers,
    body: JSON.stringify({ quotes: da.data.map((x) => ({ text: x.text, sub: x.sub, category: x.category })) })
  });
  ok('admin 原样写回 200(PUT /daily-quote)', rp.status === 200, `status=${rp.status}`);

  const d4 = await (await fetch(`${base}/daily-quote?date=2026-10-25`, { headers: auth })).json();
  ok('写回后当天金句不变', d4.data.quote.text === q.text);

  const rn = await fetch(`${base}/daily-quote/admin`);
  ok('admin 不带 key = 403', rn.status === 403, `status=${rn.status}`);

  // —— 小程序码 ——
  const rw = await fetch(`${base}/wxacode?scene=daily`, { headers: auth });
  const dw = await rw.json();
  ok('GET /wxacode 200 + url', rw.status === 200 && dw.data && dw.data.url, JSON.stringify(dw).slice(0, 160));
  if (dw.data && dw.data.url) {
    // E2E 跑在临时容器里,看不到 API 容器挂的那卷 media —— 用静态路由从外面验
    const rm = await fetch(`http://localhost:3000${dw.data.url}`);
    const buf = Buffer.from(await rm.arrayBuffer());
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    const extOk = dw.data.url.endsWith('.png') ? isPng : dw.data.url.endsWith('.jpg') ? isJpg : false;
    ok('码能从 /media 取回,魔数和扩展名对得上', rm.status === 200 && extOk, `${dw.data.url} ${buf.length}B`);
    const again = await fetch(`${base}/wxacode?scene=daily`, { headers: auth });
    ok('同 scene 再取走缓存(200)', again.status === 200);
  }
  const rbad = await fetch(`${base}/wxacode?scene=不合法的中文`, { headers: auth });
  ok('非法 scene = 400', rbad.status === 400, `status=${rbad.status}`);

  console.log(failures ? `❌ ${failures} 个失败` : '✅ E2E 全过');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('E2E 崩了:', e && e.message); process.exit(1); });
