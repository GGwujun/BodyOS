import Taro from '@tarojs/taro';

/**
 * `navigateTo` 的兜底 —— 全站跳转都从这儿走。
 *
 * 微信的跳转有内部时限:目标页没在时限内起来,这个 promise 就 reject 成
 * `navigateTo:fail timeout`。开发模式最容易踩到,而且踩得最狠的是**进分包**那一步:
 * `dist/pkg-exercise` 那边是 2MB 未压缩的 JS(光 sub-vendors.js 就 1.3MB)要先装完,
 * 而 `app.config.ts` 的 preloadRule 只在 wifi 下的首页/记录页预下 ——
 * 从趋势页、我的页点进训练/统计,就是一次冷启动。
 *
 * 裸 `Taro.navigateTo` 的后果是:**用户点了一下,屏幕什么都没发生**,控制台多一条
 * 未捕获错误(Taro 的 onError 把它报成 MiniProgramError)。这一层只做两件事,
 * 都不改变跳转本身的语义:
 *
 * 1. **连点去重** —— 同一条地址 600ms 内只认第一下。排队中的第二次跳转正是
 *    timeout 的常见来源,而且用户看不见差别(他要的就是"进去")。
 * 2. **失败说人话** —— 提示一句并放行下一次点击,而不是静默失败。
 *
 * 故意**不自动重试**:timeout 有可能是假失败(页面其实起来了,promise 先超时而已),
 * 重试会把同一个页面压两份进栈 —— 那比"再点一次"难收拾得多。所以失败后先看一眼
 * 栈顶是不是已经在目标页上,是就当成功。
 *
 * 返回 `void`(异步收在里面):调用点大多是 `onClick`,拿不到也没必要拿这个 promise。
 */
const TAP_GAP = 600;
let recent = { url: '', at: 0 };

/**
 * `switchTab` 的兜底。
 *
 * 切 tab 会销毁当前页并替换 webview;连点两下同一个 tab、或在第一次切换还没落地时
 * 又点一次,运行时就可能报 `routeDone with a webviewId … is not found`
 * (页面动作其实已经完成,只是路由回执找不到对应的 webview)。同目标 600ms 去重,
 * 和 navigate() 同一套口径;失败仍然提示,并放行下一次点击。
 */
let recentTab = { url: '', at: 0 };

/**
 * 同一时刻只放行一次跳转 —— 「同目标去重」不够。
 *
 * 报错里的 `routeDone with a webviewId … is not found` 是**路由回执找不到 webview**:
 * 第一次切换还在拆旧页,第二次跳转已经发出去,旧页没了、回执才回来。同目标连点能挡住
 * 最常见的两下,但「先点训练、马上又点记录」这种换目标的两下仍然会同时在路上。
 *
 * 所以从发起到路由落地(再留 400ms 给 webview 收尾)之间,其它跳转一律不接:
 * 屏幕已经要走了,第二下本来也到不了哪里;不接比让两个路由互相踩安全得多。
 * 3 秒没落地就强制放行 —— 回调异常不能把底栏永久锁死。
 */
let navBusy = false;
let navBusyAt = 0;
const NAV_TAIL_MS = 400;
const NAV_STUCK_MS = 3000;

function beginNav(): boolean {
  if (navBusy) {
    if (Date.now() - navBusyAt < NAV_STUCK_MS) return false;
    navBusy = false;
  }
  navBusy = true;
  navBusyAt = Date.now();
  return true;
}
function endNav(delay = NAV_TAIL_MS): void {
  setTimeout(() => { navBusy = false; }, delay);
}

/** 栈顶是不是已经在目标页(route 没有前导斜杠,参数也不参与比较) */
const barePath = (p: string) => p.replace(/^\/+/, '').split('?')[0];
function isCurrent(url: string): boolean {
  const stack = Taro.getCurrentPages?.() ?? [];
  const top = stack[stack.length - 1] as { route?: string } | undefined;
  return Boolean(top?.route) && barePath(top!.route!) === barePath(url);
}

export function switchTab(url: string): void {
  // 已经在这一页时 switchTab 是一次空跳:开发工具里照样会走一遍路由回执,
  // 正是 `routeDone … is not found` 最容易出现的地方。直接不跳。
  if (isCurrent(url)) return;
  const now = Date.now();
  if (url === recentTab.url && now - recentTab.at < TAP_GAP) return;
  if (!beginNav()) return;
  recentTab = { url, at: now };
  Taro.switchTab({ url }).then(
    () => endNav(),
    () => {
      recentTab = { url: '', at: 0 };
      endNav(0);
      void Taro.showToast({ title: '页面切换失败，请重试', icon: 'none' });
    }
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function navigate(url: string, opts: { replace?: boolean } = {}): void {
  const now = Date.now();
  if (url === recent.url && now - recent.at < TAP_GAP) return;
  if (!beginNav()) return;
  recent = { url, at: now };
  void run(url, opts.replace === true);
}

async function run(url: string, replace: boolean): Promise<void> {
  const push = replace ? Taro.redirectTo : Taro.navigateTo;
  try {
    await push({ url });
    endNav();
  } catch {
    // 先给对方一点时间:假失败的话,这一下之后栈顶就在目标页上了
    await sleep(300);
    if (arrived(url)) {
      endNav();
      return;
    }
    recent = { url: '', at: 0 }; // 放行下一次点击 —— 提示里让用户再点一下
    endNav(0);
    void Taro.showToast({ title: '页面没打开,再点一次', icon: 'none' });
  }
}

/** timeout 可能是假的:页面起来了,只是 promise 先超时。栈顶对不对是唯一可信的判据 */
function arrived(url: string): boolean {
  return isCurrent(url);
}
