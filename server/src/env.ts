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

};
