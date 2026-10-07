import { useEffect, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import LineChart from '@/components/LineChart';
import WeightSheet from '@/components/WeightSheet';
import { useWeightPlan } from '@/hooks/useWeightPlan';
import { track } from '@/services/analytics';
import { BMI_NORMAL_RANGE, bmiBand, bmiOf } from '@/utils/health';
import './index.scss';

/** 体重数据 — 目标进度环 + 初始/目标/最新 + BMI 标签 + 体重/BMI 双曲线 */
export default function WeightPage() {
  const { plan, loading, error, refresh } = useWeightPlan();
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => { track('weight_view', 'other'); }, []);

  const profile = plan?.profile;
  const heightCm = profile?.heightCm ?? null;
  const latestWeight = plan?.latestWeight ?? null;
  const bmi = bmiOf(latestWeight, heightCm);
  const band = bmi != null ? bmiBand(bmi) : null;

  // 曲线取最近 30 条,点过多在窄屏不可读
  const recent = (plan?.records ?? []).slice(-30);
  const weightPoints = recent.map((r) => ({ label: r.date.slice(5), value: r.weightKg }));
  const bmiPoints = heightCm
    ? recent.map((r) => ({ label: r.date.slice(5), value: Math.round(((bmiOf(r.weightKg, heightCm)) as number) * 10) / 10 }))
    : [];

  const goal = plan?.goal ?? null;
  const isChange = plan?.direction === -1 || plan?.direction === 1;
  const pct = plan?.progressPct;
  const ringValue = isChange ? (plan?.doneKg ?? 0).toFixed(2) : latestWeight != null ? latestWeight.toFixed(1) : '—';
  const ringLabel = isChange ? `累计${plan?.dirLabel ?? '减重'}(公斤)` : '当前体重(公斤)';
  const fmt = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toFixed(digits));

  return (
    <Screen className="weight-page">
      {loading && <Text className="status-hint">正在加载…</Text>}
      {error && <Text className="status-hint" onClick={() => refresh()}>加载失败，点击重试</Text>}

      {!loading && !error && (!goal ? (
        <View className="card guide-card">
          <Text className="fs-h1">还没有体重目标</Text>
          <Text className="fs-caption guide-copy">设置一个减脂或增肌目标后，这里会展示目标进度、体重与 BMI 曲线。</Text>
          <Button className="btn btn--primary btn--block" onClick={() => { track('weight_setup_goal', 'other'); Taro.navigateTo({ url: '/pages/onboarding/index' }); }}>去设置目标</Button>
        </View>
      ) : (
        <View className="card hero-card">
          <View className="hero-top">
            <View className="wp-ring" style={{ '--pct': `${(pct ?? 0) * 3.6}deg` } as React.CSSProperties}>
              <View className="wp-ring__inner">
                <Text className="wp-ring__num">{ringValue}</Text>
                <Text className="wp-ring__label">{ringLabel}</Text>
                {isChange && <Text className="wp-ring__sub">目标完成{pct ?? 0}%</Text>}
              </View>
            </View>
            <View className="hero-nums">
              <View className="hero-num">
                <Text className="hn-label">初始体重</Text>
                <View className="hn-pair"><Text className="hn-value">{fmt(plan?.startWeight)}</Text><Text className="hn-unit">公斤</Text></View>
              </View>
              <View className="hero-num">
                <Text className="hn-label">目标体重</Text>
                <View className="hn-pair"><Text className="hn-value">{fmt(plan?.targetWeight)}</Text><Text className="hn-unit">公斤</Text></View>
              </View>
              <View className="hero-num" onClick={() => setSheetOpen(true)}>
                <Text className="hn-label">最新体重</Text>
                <View className="hn-pair"><Text className="hn-value hn-value--green">{fmt(latestWeight)}</Text><Text className="hn-unit">公斤</Text></View>
              </View>
            </View>
          </View>

          <View className="bmi-line">
            <View className="bmi-head">
              <Text className="bmi-text">当前 BMI 值为：{bmi != null ? bmi.toFixed(2) : '—'}</Text>
              {band && <Text className={`bmi-pill tone-${band.tone}`}>{band.label}</Text>}
            </View>
            <Text className="bmi-note">根据身高体重测算，推荐 BMI 正常范围：{BMI_NORMAL_RANGE}（中国成人标准）</Text>
            {goal.type === 'endurance' && <Text className="bmi-note">当前目标为每周运动 {goal.targetValue} 分钟，体重目标设置后可看进度</Text>}
          </View>

          <View className="hero-actions">
            <Button className="btn btn--secondary hero-btn" onClick={() => Taro.navigateTo({ url: '/pages/plan/index' })}>查看方案</Button>
            <Button className="btn btn--primary hero-btn" onClick={() => { track('weight_record_open', 'other'); setSheetOpen(true); }}>+ 更新最新体重</Button>
          </View>
        </View>
      ))}

      <View className="card chart-card">
        <Text className="fs-h1">体重变化曲线</Text>
        {weightPoints.length
          ? <LineChart canvasId="weight-curve" height={180} color="#10b981" points={weightPoints} />
          : <Text className="chart-empty">暂无体重记录，点上方「更新最新体重」开始记录</Text>}
        {!!weightPoints.length && <Text className="chart-note fs-mini">▲ 体重 (kg) · 最近 {weightPoints.length} 次记录</Text>}
      </View>

      <View className="card chart-card">
        <Text className="fs-h1">BMI 变化曲线</Text>
        {!heightCm
          ? <Text className="chart-empty">完善身高资料后可查看 BMI 曲线（我的 → 编辑身体信息）</Text>
          : bmiPoints.length
            ? <LineChart canvasId="bmi-curve" height={180} color="#f59e0b" points={bmiPoints} />
            : <Text className="chart-empty">暂无体重记录，记录后即可查看 BMI 变化</Text>}
        <Text className="chart-note fs-mini">按当前身高计算；BMI 正常范围 {BMI_NORMAL_RANGE}（中国成人标准）</Text>
      </View>

      <WeightSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSaved={() => { track('weight_record_save', 'other'); void refresh(); }} />
    </Screen>
  );
}
