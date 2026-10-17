/**
 * 运行时配置
 * 开发期指向本地 Node 后端代理(见 server/),生产期替换为真实域名。
 * 小程序需在管理后台把该域名加入 request 合法域名。
 */
const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * 后端基址,优先级从高到低:
 *
 * 1. **构建时给的 `API_BASE`**(注入点在 `app/config/index.ts` 的 defineConstants)——
 *    换局域网 IP、接测试环境都不必改这份代码;
 * 2. **开发构建**:H5 走 `localhost`,小程序走**电脑的局域网 IP**(手机访问不到电脑的 localhost)。
 *    手机与电脑须在同一 WiFi;IP 变了(ipconfig 查看)用第 1 档覆盖,别改这里的默认值;
 * 3. **生产构建**:真实域名还没定,下面是**占位符**。
 */
const DEV_API =
  process.env.TARO_ENV === 'weapp' ? 'http://192.168.31.49:3000/api/v1' : 'http://localhost:3000/api/v1';
const PROD_API = 'https://api.bodyos.example.com/api/v1';

const apiBase = process.env.API_BASE || (IS_DEV ? DEV_API : PROD_API);

/**
 * 占位域名永远解析不出来:于是**生产构建一放进开发者工具,每一个接口都报
 * ERR_NAME_NOT_RESOLVED** —— 报错落在网络上,原因却在配置里,翻半天源码才想得到。
 * 启动时说一句,省掉那一轮。
 */
if (!process.env.API_BASE && !IS_DEV) {
  console.warn(
    '[config] 后端域名还是占位符(api.bodyos.example.com),所有接口都会失败:'
    + '开发者工具里请跑 npm run dev:weapp,或者构建时给 API_BASE=<你的地址>。'
  );
}

export const config = {
  /** 后端代理基址(Node 服务,负责转发云端分析与业务接口) */
  apiBase,
  /** 请求超时(ms) */
  timeout: 15000,
  /** 分析类接口超时(服务端生成较慢) */
  aiTimeout: 60000
};

export type AppConfig = typeof config;
