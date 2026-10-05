import { View } from '@tarojs/components';
import { PropsWithChildren } from 'react';
import './index.scss';
import PageNavigation from '../PageNavigation';

/**
 * 页面容器 — 统一左右安全边距与纵向间距。
 * 来源:docs/01 页面左右安全边距 16px。
 */
export default function Screen({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <View className={`screen safe-x ${className}`}>{children}<View className="screen-navigation-space" /><PageNavigation page={className} /></View>;
}
