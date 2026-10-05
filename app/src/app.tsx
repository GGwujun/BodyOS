import { PropsWithChildren } from 'react';
import { useLaunch, useDidHide } from '@tarojs/taro';
import { track, flush } from '@/services/analytics';
import '@taroify/icons/index.css';
import './app.scss';

function App({ children }: PropsWithChildren<unknown>) {
  useLaunch(() => {
    // 激活埋点(启动上报 onboarding_start)
    track('onboarding_start', 'activation');
    flush().catch(() => undefined);
  });

  // 应用切后台时批量上报剩余事件
  useDidHide(() => {
    flush().catch(() => undefined);
  });

  return children;
}

export default App;
