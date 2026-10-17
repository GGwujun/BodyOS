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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function navigate(url: string, opts: { replace?: boolean } = {}): void {
  const now = Date.now();
  if (url === recent.url && now - recent.at < TAP_GAP) return;
  recent = { url, at: now };
  void run(url, opts.replace === true);
}

async function run(url: string, replace: boolean): Promise<void> {
  const push = replace ? Taro.redirectTo : Taro.navigateTo;
  try {
    await push({ url });
  } catch {
    // 先给对方一点时间:假失败的话,这一下之后栈顶就在目标页上了
    await sleep(300);
    if (arrived(url)) return;
    recent = { url: '', at: 0 }; // 放行下一次点击 —— 提示里让用户再点一下
    void Taro.showToast({ title: '页面没打开,再点一次', icon: 'none' });
  }
}

/** timeout 可能是假的:页面起来了,只是 promise 先超时。栈顶对不对是唯一可信的判据 */
const bare = (p: string) => p.replace(/^\/+/, '').split('?')[0];
function arrived(url: string): boolean {
  const stack = Taro.getCurrentPages?.() ?? [];
  const top = stack[stack.length - 1] as { route?: string } | undefined;
  return Boolean(top?.route) && bare(top!.route!) === bare(url);
}
