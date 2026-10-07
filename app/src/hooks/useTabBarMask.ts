import { useEffect } from 'react';

/**
 * H5 专属：弹层打开时给页面容器(.taro_tabbar_page)加类抬高 z-index，
 * 让遮罩能盖住底部 tab 栏（见 Screen/index.scss 的 .tabbar-mask-open）。
 * 小程序端原生 tabBar 无法被页面内容遮盖，此 hook 为空操作。
 * 注意：不要用 :has() 实现——WXSS 编译器不支持，会导致小程序样式编译失败。
 */
export function useTabBarMask(active: boolean) {
  useEffect(() => {
    if (process.env.TARO_ENV !== 'h5' || !active) return;
    const page = document.querySelector('.taro_tabbar_page');
    if (!page) return;
    page.classList.add('tabbar-mask-open');
    return () => page.classList.remove('tabbar-mask-open');
  }, [active]);
}
