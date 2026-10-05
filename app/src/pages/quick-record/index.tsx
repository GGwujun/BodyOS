import { View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';

/** TabBar 中央快捷入口：保持独立路由，进入后切换到记录中心。 */
export default function QuickRecord() {
  useDidShow(() => {
    Taro.switchTab({ url: '/pages/record/index' });
  });

  return <View />;
}
