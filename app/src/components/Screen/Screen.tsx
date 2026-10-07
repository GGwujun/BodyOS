import { View } from '@tarojs/components';
import { PropsWithChildren } from 'react';
import './index.scss';
import PageNavigation from '../PageNavigation';
import { RoutePath, TAB_PAGES } from '@/constants/routes';

/**
 * 页面容器 — 统一左右安全边距与纵向间距。
 * 来源:docs/01 页面左右安全边距 16px。
 * 根 tab 页与 onboarding 无浮动导航,不渲染底部占位
 * (weapp 原生 tabBar 页没有 taro_tabbar_page class,占位会变成多余空白)。
 */
export default function Screen({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  const pagePath = `pages/${className.replace(/-page$/, '')}/index`;
  const isRootNav = TAB_PAGES.includes(pagePath as RoutePath) || pagePath === 'pages/onboarding/index';
  return <View className={`screen safe-x ${className}`}>{children}{!isRootNav && <View className="screen-navigation-space" />}<PageNavigation page={className} /></View>;
}
