import Taro from '@tarojs/taro';
import { trackNow } from './analytics';

/**
 * 客户端报错上报 —— 前端的「后端日志」。
 *
 * 服务端的每个请求都有日志(见 server 的请求日志中间件),但小程序端崩了、
 * 白屏了、某个页面渲染异常,服务端只能从「请求没来」间接猜 —— 这一层的盲区
 * 由这里补:JS 异常、未处理的 Promise 拒绝、路由 404,统一走埋点通道
 * (事件名 `client_error`,服务端 AnalyticsEvent 表落库,
 *  `GET /analytics/client-errors` 带管理密钥可看最近七天)。
 *
 * 防刷屏是第一设计约束:渲染错误一次 onError 可能连着来几十次(每次重渲染都炸),
 * 同一条消息一个会话最多报 3 次、全会话最多 20 条 —— 排查要的是「发生了什么、
 * 在哪个页面」,不是精确计数;真要计数,去重后的 key 也够定位。
 * 会话 = 小程序进程一次存活,杀掉重开就清零。
 */

const PER_KEY = 3;
const PER_SESSION = 20;
/** msg / stack 截多长:props 是整行落库的,几 KB 的 stack 对排查没有增量 */
const MSG_MAX = 200;
const STACK_MAX = 600;

const counts = new Map<string, number>();
let sessionTotal = 0;

/** 任意抛出的东西 → 一段可读文本(截断) */
function toText(v: unknown, max: number): string {
  let s: string;
  if (v instanceof Error) s = `${v.name}: ${v.message}`;
  else if (typeof v === 'string') s = v;
  else {
    try { s = JSON.stringify(v) ?? String(v); } catch { s = String(v); }
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function report(kind: 'js' | 'promise' | 'page_not_found', raw: unknown): void {
  const msg = toText(raw, MSG_MAX);
  if (!msg) return;
  const key = `${kind}:${msg.slice(0, 80)}`;
  const n = (counts.get(key) ?? 0) + 1;
  if (n > PER_KEY) return;
  counts.set(key, n);
  sessionTotal += 1;
  if (sessionTotal > PER_SESSION) return;

  // 报错那一刻在哪个页面 —— stack 里的路径是打包后的,页面路由才是人能对上的
  let page = '';
  try {
    const pages = Taro.getCurrentPages() as Array<{ route?: string }>;
    const last = pages[pages.length - 1];
    page = last?.route ? `/${last.route.replace(/^\//, '')}` : '';
  } catch { /* 拿不到就空着 */ }

  let appVersion = '';
  let sdk = '';
  try {
    appVersion = Taro.getAccountInfoSync()?.miniProgram?.version || '';
    const info = Taro.getSystemInfoSync();
    sdk = info.SDKVersion ?? '';
  } catch { /* 老基础库没有这些接口,留空即可 */ }

  trackNow('client_error', 'other', {
    kind,
    msg,
    // onError 传进来的字符串本身就带 stack(weapp 把 message 和 stack 拼成一段),
    // Error 对象才需要单独取 —— 两处都只留一段,免得整份存两遍
    stack: raw instanceof Error ? toText(raw.stack ?? '', STACK_MAX) : undefined,
    page,
    v: appVersion,
    sdk
  });
}

/** 挂全局钩子(在 app.tsx 的 useLaunch 里调一次,重复调用不会重复挂) */
export function installErrorReport(): void {
  Taro.onError((msg) => report('js', msg));
  // 老基础库没有的回调用可选调用兜着 —— 没有这一路就少一路,不影响另外两路
  (Taro as unknown as { onUnhandledRejection?: (cb: (r: { reason?: unknown }) => void) => void })
    .onUnhandledRejection?.((r) => report('promise', r?.reason));
  // 路由 404 只报错不接管跳转:导航那层有自己的锁(utils/nav.ts),
  // 这里再 reLaunch 兜底会和锁打架;真出现 404,先在数据里看到它
  (Taro as unknown as { onPageNotFound?: (cb: (r: { path?: string }) => void) => void })
    .onPageNotFound?.((r) => report('page_not_found', r?.path ? `页面不存在:${r.path}` : '页面不存在'));
}
