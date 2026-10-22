import { useState } from 'react';
import { Image, Picker, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import dropIcon from '@/assets/icons/drop.png';
import scaleIcon from '@/assets/icons/scale.png';
import timerIcon from '@/assets/icons/timer.png';
import WaterQuickAdd from '@/components/WaterQuickAdd';
import WeightSheet from '@/components/WeightSheet';
import { RoutePath } from '@/constants/routes';
import { bodyApi, sleepApi } from '@/services';
import { track } from '@/services/analytics';
import { useTabBarMask } from '@/hooks/useTabBarMask';
import { localDayOf, todayStr } from '@/utils/date';
import { switchTab } from '@/utils/nav';
import type { BodyMeasurement } from '@/services/types';
import { toast } from '@/utils/ui';
import './index.scss';

/** 睡眠档位:0–12 小时,半小时一格。0 是「没睡」(通宵也是一条值得记的数据) */
const SLEEP_HOURS = Array.from({ length: 25 }, (_, i) => i / 2);
const sleepLabel = (h: number) => (h === 0 ? '没睡' : `${h} 小时`);
const fmtHours = (minutes: number) => {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

/**
 * 速记 —— **不离开这一页就能记完的那三件事**:喝水、体重、睡眠。
 *
 * 挑它们的理由是「记一笔的心理成本」:喝水发生在手上有水杯的那一刻,称体重发生在刚站上秤的那一刻,
 * 那两下最贵的是时间 —— 点一下、记完,两步走人。记录页是**目录**(饮食/运动/围度/食谱
 * 各自是一整套流程,得翻进去),不跟它抢这两件事。分工一句话:
 * **要翻页的归记录,一下记完的归速记。**
 *
 * **它曾经占着 tabBar 正中间那一格,现在不在底栏了**(那一格给了训练,理由见
 * constants/routes 的 RoutePath.Training)。这一页一个字段没改 —— 变的只是入口:
 * 现在从记录页顶上那条「一下记完」进(记录页另外还有喝水/体重两格弹层,是同一个去处)。
 *
 * 它以前还是个空壳:进来自动 `switchTab` 回记录页,这一格点下去等于什么都没记。
 */
export default function QuickRecord() {
  const today = todayStr();
  const [waterToken, setWaterToken] = useState(0);
  const [showWeight, setShowWeight] = useState(false);
  /** 今天最后一次体重记录(没有就是 null)—— 列表按时间倒序,取第一条今天的 */
  const [todayWeight, setTodayWeight] = useState<BodyMeasurement | null>(null);
  /* 读失败和「今天确实还没称」以前共用同一个 null —— 接口挂了也照样劝他「站上秤记一下」。
     同一页的喝水卡早就分了三态,这张没有,于是同一屏上两套口径。 */
  const [weightFailed, setWeightFailed] = useState(false);
  /** 昨晚睡眠(分钟)。null = 还没读到;0 有两种可能(没记/真没睡),界面上都只当「还没记」处理 */
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const loadSleep = () => {
    sleepApi.getSleep(today)
      .then((r) => setSleepMinutes(r.minutes))
      .catch(() => setSleepMinutes(null));
  };
  const pickSleep = (idx: number) => {
    const hours = SLEEP_HOURS[idx] ?? 7.5;
    sleepApi.setSleep(Math.round(hours * 60))
      .then(() => {
        setSleepMinutes(Math.round(hours * 60));
        track('quick_sleep_save', 'other', { hours });
        toast('已记上');
      })
      .catch(() => toast('没记上,请重试', 'error'));
  };
  useTabBarMask(showWeight);

  const loadWeight = () => {
    bodyApi.listBodyMeasurements({ pageSize: 10 })
      // 比的是**本地**那一天(见 utils/date.localDayOf)。直接切前 10 位的话,
      // 早上 8 点前称的体重会算到昨天 —— 用户刚记完,这一页却说「今天还没称」
      .then((r) => {
        setTodayWeight(r.items.find((m) => m.weightKg != null && localDayOf(m.measuredAt) === today) ?? null);
        setWeightFailed(false);
      })
      .catch(() => { setTodayWeight(null); setWeightFailed(true); });
  };
  // 每次回到这一页都重读:刚才可能在体重页/记录页记过一笔,那一笔现在就该出现在这儿
  useDidShow(() => {
    track('quick_record_view', 'other');
    setWaterToken((n) => n + 1);
    loadWeight();
    loadSleep();
  });

  return <Screen className="quick-page">
    <View className="quick-header">
      <Text className="quick-title">今天记一笔</Text>
      <Text className="quick-sub">喝水、体重、睡眠不用翻页 —— 一下记完</Text>
    </View>

    <View className="quick-card">
      <View className="quick-card__head">
        <View className="quick-card__icon"><Image className="quick-card__icon-img" src={dropIcon} mode="aspectFit" /></View>
        <Text className="quick-card__title">喝水</Text>
        <Text className="quick-card__hint">点一下就记上</Text>
      </View>
      <WaterQuickAdd reloadToken={waterToken} />
    </View>

    <View className="quick-card">
      <View className="quick-card__head">
        <View className="quick-card__icon"><Image className="quick-card__icon-img" src={scaleIcon} mode="aspectFit" /></View>
        <Text className="quick-card__title">体重</Text>
        {!weightFailed && todayWeight?.weightKg != null && <Text className="quick-card__hint">{fmtTime(todayWeight.measuredAt)} 记过</Text>}
      </View>
      {todayWeight?.weightKg != null ? (
        <View className="quick-weigh is-done">
          <Text className="quick-weigh__value">{todayWeight.weightKg}<Text className="quick-weigh__unit"> kg</Text></Text>
          <Text className="quick-weigh__again" onClick={() => setShowWeight(true)}>再记一次 ›</Text>
        </View>
      ) : weightFailed ? (
        /* 这一整块同时也是重试入口(和喝水卡一样:说清楚没读到,并且看得出来能点) */
        <View className="quick-weigh" onClick={loadWeight}>
          <Text className="quick-weigh__empty">体重没读到 —— 点这里重试</Text>
          <Text className="quick-weigh__cta">重试 ›</Text>
        </View>
      ) : (
        <View className="quick-weigh" onClick={() => setShowWeight(true)}>
          <Text className="quick-weigh__empty">今天还没称 —— 站上秤就顺手记一下</Text>
          <Text className="quick-weigh__cta">记体重 ›</Text>
        </View>
      )}
    </View>

    <View className="quick-card">
      <View className="quick-card__head">
        <View className="quick-card__icon"><Image className="quick-card__icon-img" src={timerIcon} mode="aspectFit" /></View>
        <Text className="quick-card__title">睡眠</Text>
        {!!sleepMinutes && <Text className="quick-card__hint">昨晚的时长</Text>}
      </View>
      {!!sleepMinutes ? (
        <View className="quick-weigh is-done">
          <Text className="quick-weigh__value">{fmtHours(sleepMinutes)}<Text className="quick-weigh__unit"> 小时</Text></Text>
          <Picker
            mode="selector"
            range={SLEEP_HOURS.map(sleepLabel)}
            value={Math.min(24, Math.round(sleepMinutes / 30))}
            onChange={(e) => pickSleep(Number(e.detail.value))}
          >
            <Text className="quick-weigh__again">改一下 ›</Text>
          </Picker>
        </View>
      ) : (
        <Picker
          mode="selector"
          range={SLEEP_HOURS.map(sleepLabel)}
          value={15}
          onChange={(e) => pickSleep(Number(e.detail.value))}
        >
          <View className="quick-weigh">
            <Text className="quick-weigh__empty">昨晚睡了多久?选一下就记上</Text>
            <Text className="quick-weigh__cta">记睡眠 ›</Text>
          </View>
        </Picker>
      )}
    </View>

    {/* 其余的记录各自是一整套流程(选食物、选运动类型、量几处围度),翻页才说得清,
        所以它们的入口留在记录页 —— 这里只给一条明确的路,不再摆一排卡片 */}
    <View className="quick-more" onClick={() => switchTab(`/${RoutePath.Record}`)}>
      <Text className="quick-more__text">饮食 · 运动 · 围度 · 力量训练</Text>
      <Text className="quick-more__action">去记录页 ›</Text>
    </View>

    <WeightSheet
      open={showWeight}
      onClose={() => setShowWeight(false)}
      onSaved={() => { track('quick_weight_save', 'other'); loadWeight(); }}
    />
  </Screen>;
}

/** 只取时分 —— 这一页关心的不是哪一天(反正就是今天),是「刚才还是早上」 */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
