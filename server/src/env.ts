import dotenv from 'dotenv';
dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || '',

  // 智谱 GLM
  zhipuApiKey: process.env.ZHIPU_API_KEY || '',
  /** Anthropic 兼容端点基址 */
  zhipuBaseUrl: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/anthropic',
  zhipuModel: process.env.ZHIPU_MODEL || 'glm-4.6',

  // 微信小程序登录(注册后在管理后台"开发管理-开发设置"获取)
  // 未配置时 /auth/wechat 回落开发用户 u_1,便于本地调试
  wechatAppId: process.env.WECHAT_APPID || '',
  wechatAppSecret: process.env.WECHAT_APP_SECRET || '',

  // 平台指标接口(/analytics/metrics)的管理密钥;生产未配置时该接口返回 404
  adminApiKey: process.env.ADMIN_API_KEY || '',

};
