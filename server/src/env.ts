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
  // 训练提醒的订阅消息模板 id(小程序后台"订阅消息"里申请后填到这里)
  // 未配置时:定时发送整条链路空转,小程序内提醒照常 —— 用户点授权也收不到,故如实告知
  wechatTmplTraining: process.env.WECHAT_TMPL_TRAINING || '',

  // 平台指标接口(/analytics/metrics)的管理密钥;生产未配置时该接口返回 404
  adminApiKey: process.env.ADMIN_API_KEY || '',

  // 用户上传的媒体(进度照片等)落盘目录;经 GET /media/:file 静态提供。
  // 相对路径按 server/ 解析,部署时挂持久卷即可。
  mediaDir: process.env.MEDIA_DIR || 'media',

};
