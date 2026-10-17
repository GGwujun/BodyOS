import express from 'express';
import cors from 'cors';
import { isAbsolute, resolve } from 'node:path';
import { env } from './env';
import { startReminderTicker } from './lib/reminderRunner';
import routes from './routes';

const app = express();

app.use(cors());
app.use(express.json({ limit: '8mb' })); // 食物图片 base64 体积较大

// 媒体目录,两类东西:① 用户上传的照片(文件名是内容哈希);
// ② ex/ 下的动作演示图(随版本发布,文件名固定)—— 两类都是内容永不变化,可以放心长缓存。
// 演示图在前端是 <Image src> 直接加载的**网络地址**,要走微信后台的 downloadFile 白名单
// (和 request 白名单是两个列表,域名同一个)。
const mediaDir = isAbsolute(env.mediaDir) ? env.mediaDir : resolve(process.cwd(), env.mediaDir);
app.use('/media', express.static(mediaDir, { maxAge: '365d', immutable: true, index: false, dotfiles: 'deny' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 业务 + AI 路由,统一挂在 /api/v1
app.use('/api/v1', routes);

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[BodyOS Server] error:', err);
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
});
