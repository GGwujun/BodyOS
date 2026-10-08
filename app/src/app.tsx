import { PropsWithChildren, useState } from 'react';
import Taro, { useLaunch, useDidHide } from '@tarojs/taro';
import { View, Text } from '@tarojs/components';
import { userApi } from '@/services';
import { ensureLogin } from '@/services/login';
import { flush } from '@/services/analytics';
// taroify 图标样式:本地化副本(字体 base64 内联),不再依赖远程 CDN 字体
import '@/styles/taroify-icons.scss';
import './app.scss';

/**
 * 启动遮罩只盖冷启动的「静默登录 + 新用户判断」窗口期,
 * 避免先闪一版空数据首页、新用户再闪一次 reLaunch 到引导页。
 * 模块级标记:App 组件按页面树实例化时,后挂载的树直接跳过遮罩。
 */
let bootHidden = false;

function App({ children }: PropsWithChildren<unknown>) {
  const [booted, setBooted] = useState(bootHidden);

  useLaunch(() => {
    if (bootHidden) return;
    const boot = async () => {
      // 静默登录(weapp):拿 token,失败不阻塞,后续请求走无 token 回落。
      await ensureLogin();
      // 新用户检测:无激活目标时进入引导页设置目标。
      // 仅在明确拿到空目标列表时跳转;网络/接口失败不拦截正常使用。
      const goals = await userApi.listGoals().catch(() => null);
      if (goals && goals.length === 0) {
        // 等跳转落地再收遮罩,引导页首帧也在遮罩后面就绪
        await Taro.reLaunch({ url: '/pages/onboarding/index' }).catch(() => undefined);
      }
    };
    // 与 6s 兜底竞速:慢网时不再让用户停在遮罩上,交给页面自身加载态
    void Promise.race([boot(), new Promise((resolve) => setTimeout(resolve, 6000))])
      .finally(() => {
        bootHidden = true;
        setBooted(true);
      });
  });

  // 应用切后台时批量上报剩余事件
  useDidHide(() => {
    flush().catch(() => undefined);
  });

  return (
    <>
      {children}
      {!booted && (
        <View className="boot-splash">
          <View className="boot-logo">
            <Text className="boot-logo-text">轻</Text>
          </View>
          <Text className="boot-name">轻身记</Text>
          <Text className="boot-slogan">记录饮食、运动与身体数据，看清每一天的变化</Text>
          <View className="boot-spinner" />
          <Text className="boot-tip">正在进入…</Text>
        </View>
      )}
    </>
  );
}

export default App;
