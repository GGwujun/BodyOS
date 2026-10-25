import { useEffect, useRef } from 'react';
import { Text } from '@tarojs/components';
import type { ITouchEvent } from '@tarojs/components';

/**
 * 长按连发的步进按钮 —— 按住不放就一直走。
 *
 * 用在训练页/工具页那些「−/＋」上:轻点一下走一格(和从前一样),
 * 按住 ~400ms 先走一格,然后慢速连发(120ms 一格),连发满 12 格换快档(50ms 一格)。
 * 一开场就 50ms 的话,想 +2 的人按半秒就飞出去七八格;一直 120ms 的话,
 * 从 0 调到 40 要按住五秒 —— 先慢后快,两头都顾。
 *
 * 微信里 longpress 之后**不会**再补发 tap,松手不会多走一格。
 * 每次点击都 `stopPropagation`:步进按钮的点击不该再把外层(比如计时组的开始/按停)带出来 ——
 * 就算哪一层暂时没监听,先拦住也不会错。
 *
 * 事件值永远是函数(Taro 3.6 的事件红线,见 utils/taro-events):四个 handler 全写实函数,
 * 不存在条件挂载,`onStep` 必填由类型兜底。
 */
export default function HoldText({
  className, children, onStep
}: {
  className?: string;
  children: string;
  /** 走一格。长按连发也是这一个函数,页面不用区分轻点还是按住 */
  onStep: () => void;
}) {
  const cb = useRef(onStep);
  cb.current = onStep;
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const n = useRef(0);

  const stop = () => {
    if (tick.current != null) {
      clearInterval(tick.current);
      tick.current = null;
    }
  };
  // 卸载兜底清一次:连着的 interval 不清会活到页面销毁 —— 「退出训练」之后还在每 50ms 改数
  useEffect(() => stop, []);

  const start = () => {
    cb.current();
    n.current = 0;
    stop();
    tick.current = setInterval(() => {
      n.current += 1;
      if (n.current === 12) {
        // 换快档:清掉慢的那个,起一个 50ms 的
        stop();
        tick.current = setInterval(() => cb.current(), 50);
      }
      cb.current();
    }, 120);
  };

  const tap = (e: ITouchEvent) => {
    e.stopPropagation();
    cb.current();
  };

  return (
    <Text
      className={className}
      onClick={tap}
      onLongPress={start}
      onTouchEnd={stop}
      onTouchCancel={stop}
    >
      {children}
    </Text>
  );
}
