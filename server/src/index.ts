import express from 'express';
import cors from 'cors';
import { env } from './env';
import { prisma } from './db';
import { healthCheck } from './lib/health';
import { getMediaDir } from './lib/mediaDir';
import { startReminderTicker } from './lib/reminderRunner';
import { startWeeklyTicker } from './lib/weeklyRunner';
import { logError, logInfo, logWarn } from './lib/log';
import routes from './routes';

const app = express();

app.use(cors());
app.use(express.json({ limit: '8mb' })); // 食物图片 base64 体积较大

// 媒体目录,两类东西:① 用户上传的照片(文件名是内容哈希);
// ② ex/ 下的动作演示图(随版本发布,文件名固定)—— 两类都是内容永不变化,可以放心长缓存。
// 演示图在前端是 <Image src> 直接加载的**网络地址**,要走微信后台的 downloadFile 白名单
// (和 request 白名单是两个列表,域名同一个)。
const mediaDir = getMediaDir();
app.use('/media', express.static(mediaDir, { maxAge: '365d', immutable: true, index: false, dotfiles: 'deny' }));

/**
 * 存活探针:真的做一遍最要紧的两件事(查数据库、写媒体目录,见 lib/health.ts)再答话。
 * 探针失败回 503 —— 外面的监控(容器健康检查、宝塔/阿里云的拨测)靠状态码判断,
 * 回 200 带 error 字段它们看不懂。
 */
app.get('/health', async (_req, res) => {
  const r = await healthCheck(mediaDir, () => prisma.$queryRaw`SELECT 1`);
  if (r.ok) return res.json({ status: 'ok' });
  logError('http', '健康检查失败', undefined, { probe: r.why });
  res.status(503).json({ code: 503, message: '服务不健康', data: null });
});

/**
 * 请求日志:线上排查唯一靠谱的入口。
 *
 * nginx 只记了路径和状态码,应用内部的失败原因(解密失败/Prisma 异常)它看不见;
 * 这里把方法、路径、状态、耗时、用户和 `err()` 给出的错误文案串成一行。
 * 查询串一律不记(可能带敏感参数),令牌/请求体也不记。
 */
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const startedAt = Date.now();
  // 必须在进路由前取路径:finish 时 req.url 已被 Express 按挂载点改写过
  const path = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    const detail = {
      method: req.method,
      path,
      status: res.statusCode,
      ms: Date.now() - startedAt,
      userId: (res.locals as Record<string, unknown>).userId ?? null,
      error: (res.locals as Record<string, unknown>).errorMessage ?? undefined
    };
    if (res.statusCode >= 500) logError('http', '请求失败', undefined, detail);
    else if (res.statusCode >= 400) logWarn('http', '请求被拒绝', detail);
    else logInfo('http', '请求完成', detail);
  });
  next();
});

// 业务 + AI 路由,统一挂在 /api/v1
app.use('/api/v1', routes);

app.use(
  (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logError('http', '未捕获异常', err, {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      userId: (res.locals as Record<string, unknown>).userId ?? null
    });
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
);

app.listen(env.port, () => {
  console.log(`✅ BodyOS server on http://localhost:${env.port}`);
  console.log(`   智谱模型: ${env.zhipuModel}`);
  if (!env.zhipuApiKey) {
    console.warn('   ⚠️  未配置 ZHIPU_API_KEY,AI 接口将不可用。请在 .env 设置后重启。');
  }
  if (!env.wechatAppId || !env.wechatAppSecret) {
    console.warn('   ⚠️  未配置 WECHAT_APPID/WECHAT_APP_SECRET,登录回落开发用户 u_1。');
  }
  // 训练提醒:小程序没有本地通知,到点提醒只能由服务端发订阅消息
  startReminderTicker();
  // 周报推送:每周一早上把上周摘要推给开通了的用户(另一个模板、另一份额度)
  startWeeklyTicker();
});
