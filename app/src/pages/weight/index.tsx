import { themedColor } from '@/utils/theme';
import { useEffect, useState } from 'react';
import { Button, Picker, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import LineChart from '@/components/LineChart';
import WeightSheet from '@/components/WeightSheet';
import { useWeightPlan } from '@/hooks/useWeightPlan';
import { track } from '@/services/analytics';
import { mondayOf, todayStr } from '@/utils/date';
import { BMI_NORMAL_MAX, BMI_NORMAL_RANGE, bmiBand, bmiOf } from '@/utils/health';
import { BODY_SPANS, spanFilter, type BodySpan } from '@/utils/girth';
import { weekDelta, weeklyWeights, weeksApart } from '@/utils/weekly-weight';
import './index.scss';
import { THEME } from '@/constants/theme';
import { navigate } from '@/utils/nav';
import { onIf } from '@/utils/taro-events';

/** 周均值列表显示几周 —— 再多就得翻,而减脂的窗口也就一两个月 */
const WEEK_ROWS = 6;

/** 体重数据 — 目标进度环 + 初始/目标/最新 + BMI 标签 + 体重/BMI 双曲线 */
export default function WeightPage() {
  const { plan, loading, error, refresh } = useWeightPlan();
  const [sheetOpen, setSheetOpen] = useState(false);
  /** 曲线看多远(只管两张曲线图;进度环、周均值看的是全程,不跟着窗口缩) */
  const [span, setSpan] = useState<BodySpan>('all');
  useEffect(() => { track('weight_view', 'other'); }, []);
  // 从「查看方案」删除/重置目标返回后,进度环与曲线不再显示已删数据
  useDidShow(() => { void refresh(); });

  const profile = plan?.profile;
  const heightCm = profile?.heightCm ?? null;
  const latestWeight = plan?.latestWeight ?? null;
  const bmi = bmiOf(latestWeight, heightCm);
  const band = bmi != null ? bmiBand(bmi) : null;

  // 曲线画区间里的记录(默认「全部」= 一条不藏;以前固定截最近 30 条,现在把远近交给用户)。
  // 周均值、目标进度这些数字看的仍是全程
  const today = todayStr();
  const spanLabel = BODY_SPANS.find((s) => s.k === span)?.label ?? '全部';
  const windowed = spanFilter(plan?.records ?? [], span, today);
  const hasAnyRecord = (plan?.records ?? []).length > 0;
  const weightPoints = windowed.map((r) => ({ label: r.date.slice(5), value: r.weightKg }));
  const bmiPoints = heightCm
    ? windowed.map((r) => ({ label: r.date.slice(5), value: Math.round(((bmiOf(r.weightKg, heightCm)) as number) * 10) / 10 }))
    : [];

  const goal = plan?.goal ?? null;
  const isChange = plan?.direction === -1 || plan?.direction === 1;
  const pct = plan?.progressPct;

  // 周均值 —— 这个页面上唯一能回答「我到底有没有在瘦」的数字(单日数字先被水分盖住)
  const weeks = weeklyWeights(plan?.records ?? []);
  const thisWeek = mondayOf(todayStr());
  const head = weeks[0] ?? null;
  const headDelta = weekDelta(head?.delta ?? null);
  // 变化是「朝着目标的」还是「背着的」:减脂期往下是绿,增肌期往上是绿;
  // 维持/没有目标的用户不判方向,一律中性色
  const weekTone = (dir: -1 | 0 | 1): string => {
    if (!dir || !plan?.direction) return 'tone-flat';
    return (dir < 0) === (plan.direction === -1) ? 'tone-good' : 'tone-flat';
  };
  const headDeltaLabel = !head?.prevStart
    ? ''
    : weeksApart(head.prevStart, head.start) > 1
      ? '比上次有记录的周'
      : '比上周';
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
          <Button className="btn btn--primary btn--block" onClick={() => { track('weight_setup_goal', 'other'); navigate('/pages/onboarding/index?from=nav'); }}>去设置目标</Button>
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
            <Button className="btn btn--secondary hero-btn" onClick={() => navigate('/pages/plan/index')}>查看方案</Button>
            <Button className="btn btn--primary hero-btn" onClick={() => { track('weight_record_open', 'other'); setSheetOpen(true); }}>+ 更新最新体重</Button>
          </View>
        </View>
      ))}

      {!!head && (
        <View className="card week-card">
          <Text className="fs-h1">每周均值</Text>
          <View className="wk-head">
            <View className="wk-head__main">
              <View className="wk-avg-line">
                <Text className={`wk-avg ${weekTone(headDelta.dir)}`}>{head.avg.toFixed(1)}</Text>
                <Text className="wk-unit">公斤</Text>
              </View>
              <Text className="wk-when">{head.start === thisWeek ? '本周均值' : `${head.start.slice(5)} 那周`}</Text>
            </View>
            <View className="wk-head__delta">
              <Text className={`wk-delta ${weekTone(headDelta.dir)}`}>{headDelta.text}</Text>
              <Text className="wk-delta__label">{headDeltaLabel || '还没有上周可比'}</Text>
            </View>
          </View>

          <View className="wk-list">
            {weeks.slice(0, WEEK_ROWS).map((w) => {
              const d = weekDelta(w.delta);
              return (
                <View key={w.start} className={`wk-row${w.start === thisWeek ? ' wk-row--now' : ''}`}>
                  <Text className="wk-row__week">
                    {w.start.slice(5)} ~ {w.end.slice(5)}{w.start === thisWeek ? ' · 本周' : ''}
                  </Text>
                  <Text className="wk-row__n">{w.n} 次</Text>
                  <Text className="wk-row__avg">{w.avg.toFixed(1)}</Text>
                  <Text className={`wk-row__delta ${weekTone(d.dir)}`}>{d.text}</Text>
                </View>
              );
            })}
          </View>

          <Text className="chart-note fs-mini">
            {weeks.length < 2
              ? '再称一周,这里就能比出周与周的变化。'
              : '一天之内体重会随水分、盐和上一顿饭浮动好几斤,而真实变化一周也就 0.3 ~ 0.7 公斤 —— 所以看周均值,别盯单日数字。'}
          </Text>
        </View>
      )}

      <View className="card chart-card">
        {/* 区间只管两张曲线图,摆卡片头上 —— 和围度页、动作历史页同一摆法 */}
        <View className="wc-head">
          <Text className="fs-h1">体重变化曲线</Text>
          <Picker
            mode="selector"
            range={BODY_SPANS.map((s) => s.label)}
            value={BODY_SPANS.findIndex((s) => s.k === span)}
            onChange={(e) => setSpan(BODY_SPANS[Number(e.detail.value)]?.k ?? 'all')}
          >
            <Text className="wc-span">{spanLabel} ⌄</Text>
          </Picker>
        </View>
        {weightPoints.length
          ? (
            <LineChart
              canvasId="weight-curve"
              height={180}
              color={themedColor(THEME.primary)}
              points={weightPoints}
              unit="公斤"
              target={plan?.targetWeight != null ? { value: plan.targetWeight, label: '目标' } : null}
            />
          )
          /* 空窗 / 有目标 / 没目标合成**同一个** Text:同标签分支一个有 onClick 一个没有,
             React 会当成同一个节点改 props,把 onClick 摘掉那一步会让整棵子树崩掉
             (见 utils/taro-events)。外层那支(<LineChart> 对 <Text>)标签不同,是卸载+挂载,不受影响 */
          : (
            <Text
              className="chart-empty"
              onClick={onIf(!goal, () => navigate('/pages/onboarding/index?from=nav'))}
            >
              {hasAnyRecord && !windowed.length
                ? '这段时间没有体重记录，换长一点的区间能看到之前的。'
                : goal
                  ? '暂无体重记录，点上方「更新最新体重」开始记录'
                  : '设置目标后开始记录体重，去设置目标 ›'}
            </Text>
          )}
        {!!weightPoints.length && (
          <Text className="chart-note fs-mini">
            ▲ 体重 (kg) · {spanLabel} · {weightPoints.length} 次记录{head ? '(单日数字,含水分波动;看趋势请用上面的周均值)' : ''}
          </Text>
        )}
      </View>

      <View className="card chart-card">
        <View className="wc-head">
          <Text className="fs-h1">BMI 变化曲线</Text>
          {/* 和体重曲线同一个区间、同一个选择器 —— 两张图一起缩放,不用各调一遍 */}
          <Picker
            mode="selector"
            range={BODY_SPANS.map((s) => s.label)}
            value={BODY_SPANS.findIndex((s) => s.k === span)}
            onChange={(e) => setSpan(BODY_SPANS[Number(e.detail.value)]?.k ?? 'all')}
          >
            <Text className="wc-span">{spanLabel} ⌄</Text>
          </Picker>
        </View>
        {!heightCm
          ? <Text className="chart-empty">完善身高资料后可查看 BMI 曲线（我的 → 编辑身体信息）</Text>
          : bmiPoints.length
            ? (
              <LineChart
                canvasId="bmi-curve"
                height={180}
                color={themedColor(THEME.warning)}
                points={bmiPoints}
                target={{ value: BMI_NORMAL_MAX, label: '正常上限' }}
              />
            )
            : <Text className="chart-empty">{hasAnyRecord && !windowed.length ? '这段时间没有体重记录，换个区间能看到之前的。' : '暂无体重记录，记录后即可查看 BMI 变化'}</Text>}
        {!!heightCm && <Text className="chart-note fs-mini">按当前身高计算；BMI 正常范围 {BMI_NORMAL_RANGE}（中国成人标准）</Text>}
      </View>

      <View className="card chart-card">
        <Text className="fs-h1">围度记录</Text>
        <Text className="chart-empty fs-mini">体重只说明重了多少,围度才说明变在哪 —— 减脂期体重没动、腰围细了两厘米,是常有的事。</Text>
        <Button className="btn btn--secondary btn--block" onClick={() => navigate('/pages/measure/index')}>量一次围度和体脂</Button>
      </View>

      <WeightSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSaved={() => { track('weight_record_save', 'other'); void refresh(); }} />
    </Screen>
  );
}
