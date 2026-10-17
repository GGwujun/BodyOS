/**
 * 离开前的拦一下 —— 页面里还有**没落盘的东西**时,别让一次误点把它带走。
 *
 * 为什么需要:全站每个非 tab 页都挂着那个浮动底栏(components/PageNavigation),
 * 而它走的是 `Taro.switchTab` —— 微信的语义是「跳到 tabBar 页并**关掉所有非 tabBar 页面**」。
 * 页面上那些还没写进 storage 的东西(本次训练的组数、填了一半的表单)就这么没了,
 * 而且**没有任何提示**。原生返回键同理:小程序能拦的地方只有 `enableAlertBeforeUnload`。
 *
 * 谁登记谁负责:默认**没有**守卫(直接放行)—— 只是把「有没有话要说」留给页面,
 * 因为只有页面自己知道什么算「做完了」。登记的是一个**判断函数**而不是一个布尔值:
 * 页面挂在后台时,状态可能已经落盘(比如训练结束了),按钮点下去那一刻再问才对。
 *
 * 单槽:同一时刻只有栈顶那一个页面在跟用户打交道,所以一个槽就够(多页面同时登记
 * 只会互相覆盖 —— 而那种情况在这个应用里不存在)。
 */
import Taro from '@tarojs/taro';

export interface LeaveGuard {
  /** 现在还有没有没落盘的东西(每次要离开时才问) */
  dirty: () => boolean;
  /** 问一句的标题与正文 */
  title: string;
  content: string;
  /** 确认离开那个按钮上写什么(默认「放弃」) */
  confirmText?: string;
}

let current: LeaveGuard | null = null;

/** 登记 / 注销(传 null)。页面挂载时登记,卸载时注销 */
export function setLeaveGuard(g: LeaveGuard | null): void {
  current = g;
}

/** 现在登记的守卫(托盘页面/测试用) */
export function peekLeaveGuard(): LeaveGuard | null {
  return current;
}

/**
 * 问一句能不能走。**没登记、或者登记的那个说不脏 → 直接放行**。
 * 弹窗本身是页面的口吻(标题/正文都由登记方给),这里只负责在用户点确认之前拦住。
 */
export async function confirmLeave(): Promise<boolean> {
  const g = current;
  if (!g || !g.dirty()) return true;
  const res = await Taro.showModal({
    title: g.title,
    content: g.content,
    confirmText: g.confirmText ?? '放弃',
    cancelText: '留下'
  });
  return res.confirm === true;
}

/**
 * 把「没做完」这件事同步给**原生**返回键(左上角返回 / 手势返回 / 安卓物理返回)。
 *
 * 小程序里这一处**只能**用 `enableAlertBeforeUnload` 拦,而且它拦不住我们自己的
 * `Taro.navigateBack()` —— 所以正常离开时(训练结束、用户确认放弃之后)记得关掉,
 * 不然自己跳转还要再点一次弹窗。
 * 只在 weapp 上有这个 API,H5/开发工具里没有:没有就当没有,不能因此报错。
 */
export function syncNativeGuard(on: boolean, message?: string): void {
  try {
    if (on && typeof Taro.enableAlertBeforeUnload === 'function') {
      Taro.enableAlertBeforeUnload({ message: message ?? '有还没保存的内容,确定要离开吗?' });
    } else if (!on && typeof Taro.disableAlertBeforeUnload === 'function') {
      Taro.disableAlertBeforeUnload();
    }
  } catch {
    // 平台不支持 / 页面已销毁 —— 拦不住也不该把正常流程弄崩
  }
}
