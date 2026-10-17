import { useEffect, useState } from 'react';
import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { waterApi } from '@/services';
import type { WaterStatus } from '@/services/types';
import { toast } from '@/utils/ui';
import { onIf } from '@/utils/taro-events';
import { todayStr } from '@/utils/date';
import './index.scss';

interface WaterQuickAddProps {
  /**
   * 正在请求 —— 外面那层弹层用来判断「点空白能不能关掉」。
   * 记到一半被关掉不会丢数据(请求已经发出去了),但那一杯的反馈(toast)会跟着页面一起消失,
   * 看起来就像没记上。
   */
  onBusy?: (busy: boolean) => void;
  /**
   * 变一下就重新拉一次今日水量。记录页是弹层(mount 即拉),速记页是常驻的 tab
   * —— 从别的页面回来时得让它重读(见 pages/quick-record)。
   */
  reloadToken?: number;
}

/**
 * 「今天喝了多少 + 再记一杯」—— 记录页的喝水弹层、速记页,用的是同一份。
 *
 * 为什么要抽出来:喝水的规矩不少(四个常用档、自定义 1-2000、清零要二次确认、
 * 目标达成要说一句),两处各写一遍的下场是**两处记的水不一样** ——
 * 一处能记 2000 另一处不能,用户会以为是 App 坏了。
 *
 * 为什么是「加号」而不是输入框:喝水这件事发生在**手上有水杯的那一刻**,
 * 那一下的心理成本决定了记不记得下来 —— 点一下 +250 就走,比填一个数快一个数量级。
 */
export default function WaterQuickAdd({ onBusy, reloadToken = 0 }: WaterQuickAddProps) {
  const [water, setWater] = useState<WaterStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [customMl, setCustomMl] = useState('');
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    waterApi.getWater(todayStr())
      .then(setWater)
      .catch(() => { setWater(null); setFailed(true); });
  };
  useEffect(load, [reloadToken]);
  useEffect(() => { onBusy?.(adding); }, [adding]);

  const add = (amountMl: number) => {
    if (adding) return;
    setAdding(true);
    waterApi.addWater(amountMl, todayStr())
      .then((w) => { setWater(w); toast(`+${amountMl} ml`); })
      .catch((e) => toast((e as { message?: string })?.message || '打卡失败，请重试', 'error'))
      .finally(() => setAdding(false));
  };
  const addCustom = () => {
    const v = Number(customMl);
    if (!customMl.trim() || !Number.isInteger(v) || v <= 0 || v > 2000) return toast('请输入 1-2000 的整数毫升', 'none');
    setCustomMl('');
    add(v);
  };
  const reset = async () => {
    const { confirm } = await Taro.showModal({ title: '清零重记', content: '把今天的饮水记录清零吗？' });
    if (!confirm) return;
    try { setWater(await waterApi.setWater(0, todayStr())); toast('已清零'); }
    catch (e) { toast((e as { message?: string })?.message || '操作失败', 'error'); }
  };
  const pct = water ? Math.min(100, Math.round((water.amountMl / Math.max(water.goalMl, 1)) * 100)) : 0;

  return <View className="water-quick">
    <View className="water-status">
      <Text className="water-amount">{water ? water.amountMl : '—'}</Text>
      {/* 目标只在真的读到时才写。以前读不到也显示一个 1500 —— 那是个**编出来的数**,
          用户会把「— / 1500 ml」当成「今天还差 1500」,而它只是客户端兜底 */}
      {water != null && <Text className="water-goal">/ {water.goalMl} ml</Text>}
      {water != null && water.amountMl >= water.goalMl && water.goalMl > 0 && <Text className="water-done">已达标</Text>}
    </View>
    <View className="water-bar"><View className="water-bar__fill" style={{ width: `${pct}%` }} /></View>
    {/* 这一行是**唯一**的状态出口:读到了说进度,没读到说没读到(并且点一下能重试)。
        以前失败时这一行还在说「今天的饮水量还不知道」,上面另起一行说「加载失败」——
        同一个事实两句话,一句还劝人「记一杯就是起点」(可数据压根没读到,记了也不知道算不算)。
        三种状态互斥:在读 / 读失败 / 读到了。

        **这三种状态必须是同一个 <Text>**,不能拆成「读到的那支」和「没读到的那支」两个
        分支:React 会把同一位置、同一个标签的两个分支认成**同一个节点**去改 props,
        于是 water 一读到就把 onClick 摘掉 —— 「事件属性从函数变成没有」正好踩上那次崩溃
        (抛在 Taro 的 removeEventListener 里,整棵子树点废,见 utils/taro-events)。
        所以下面只有**一份** className、**一份**文案,处理器永远绑着、条件写在函数体里。

        代价是 className 里的判断要写成 `water == null && failed` 而不是 `failed` ——
        读到了以后即使上一轮失败过,这一行也不该再是「失败」的样式。 */}
    <Text
      className={`water-pct${water == null && failed ? ' is-failed' : ''}`}
      onClick={onIf(water == null && failed, load)}
    >
      {water != null ? `今日目标已完成 ${pct}%` : failed ? '今日水量没读到 —— 点这里重试' : '正在读今天的饮水量…'}
    </Text>
    <View className="water-chips">
      {[100, 200, 250, 300].map((ml) => (
        <Text key={ml} className={`water-chip${adding ? ' is-busy' : ''}`} onClick={() => add(ml)}>+{ml} ml</Text>
      ))}
    </View>
    <View className="water-custom">
      <Input
        className="water-custom-input" type="number" placeholder="自定义毫升数"
        value={customMl} onInput={(e) => setCustomMl(e.detail.value)}
      />
      <Button className="btn btn--mini water-add" disabled={adding} onClick={addCustom}>添加</Button>
    </View>
    {water != null && water.amountMl > 0 && <Text className="water-reset" onClick={reset}>记错了？清零重记</Text>}
  </View>;
}
