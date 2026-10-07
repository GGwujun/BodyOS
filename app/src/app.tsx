import { PropsWithChildren } from 'react';
import Taro, { useLaunch, useDidHide } from '@tarojs/taro';
import { userApi } from '@/services';
import { ensureLogin } from '@/services/login';
import { flush } from '@/services/analytics';
import '@taroify/icons/index.css';
import './app.scss';

function App({ children }: PropsWithChildren<unknown>) {
  useLaunch(() => {
    // 静默登录(weapp):拿 token,失败不阻塞。
    void ensureLogin().finally(() => {
      // 新用户检测：无激活目标时进入引导页设置目标。
      // 仅在明确拿到空目标列表时跳转；网络/接口失败不拦截正常使用。
      userApi.listGoals()
        .then(goals => {
          if (goals.length === 0) Taro.reLaunch({ url: '/pages/onboarding/index' });
        })
        .catch(() => undefined);
    });
  });

  // 应用切后台时批量上报剩余事件
  useDidHide(() => {
    flush().catch(() => undefined);
  });

  return children;
}

export default App;
