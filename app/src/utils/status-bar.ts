import Taro from '@tarojs/taro';

/**
 * 状态栏高度(px)。
 *
 * 只有 `navigationStyle: 'custom'` 的页面需要它:原生导航栏会自己让出状态栏,
 * 自定义头得自己补 —— 少补这一块,标题就压在时间/信号下面。
 *
 * 取不到(极少见)时给 20:这是常见安卓/iPhone 状态栏的高度,
 * 比 0 安全 —— 给 0 是一定会被遮挡,给 20 最多多留一点空。
 */
export function statusBarHeight(): number {
  try {
    const h = Taro.getSystemInfoSync().statusBarHeight;
    return typeof h === 'number' && h > 0 ? h : 20;
  } catch {
    return 20;
  }
}
