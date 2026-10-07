import express from 'express';
import cors from 'cors';
import { env } from './env';
import routes from './routes';

const app = express();

app.use(cors());
app.use(express.json({ limit: '8mb' })); // 食物图片 base64 体积较大

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
});
