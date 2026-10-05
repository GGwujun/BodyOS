/**
 * 运行时配置
 * 开发期指向本地 Node 后端代理(见 server/),生产期替换为真实域名。
 * 小程序需在管理后台把该域名加入 request 合法域名。
 */
const IS_DEV = process.env.NODE_ENV === 'development';

export const config = {
  /** 后端代理基址(Node 服务,负责转发智谱 AI 与业务接口) */
  apiBase: IS_DEV ? 'http://localhost:3000/api/v1' : 'https://api.bodyos.example.com/api/v1',
  /** 请求超时(ms) */
  timeout: 15000,
  /** AI 接口超时(智谱响应较慢) */
  aiTimeout: 60000
};

export type AppConfig = typeof config;
