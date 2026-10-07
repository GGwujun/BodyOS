/**
 * 运行时配置
 * 开发期指向本地 Node 后端代理(见 server/),生产期替换为真实域名。
 * 小程序需在管理后台把该域名加入 request 合法域名。
 */
const IS_DEV = process.env.NODE_ENV === 'development';
// 真机预览:手机无法访问电脑的 localhost,weapp 开发构建改走电脑局域网 IP。
// IP 变化(ipconfig 查看)后需同步更新;手机与电脑须在同一 WiFi。
const WEAPP_DEV_API = 'http://192.168.31.49:3000/api/v1';

export const config = {
  /** 后端代理基址(Node 服务,负责转发云端分析与业务接口) */
  apiBase: IS_DEV
    ? (process.env.TARO_ENV === 'weapp' ? WEAPP_DEV_API : 'http://localhost:3000/api/v1')
    : 'https://api.bodyos.example.com/api/v1',
  /** 请求超时(ms) */
  timeout: 15000,
  /** AI 接口超时(智谱响应较慢) */
  aiTimeout: 60000
};

export type AppConfig = typeof config;
