import { useState } from 'react';
import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ArrowRight, ArrowDown } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import { RoutePath, TAB_PAGES } from '@/constants/routes';
import { summaryApi } from '@/services';
import { track } from '@/services/analytics';
import { todayStr } from '@/utils/date';
import type { DailyAnalysis } from '@/services/types';
import './index.scss';


export default function Home() {
  const today = todayStr();
  const { data, loading, error, refresh } = useAsync(() => summaryApi.getDailySummary(todayStr()), []);

  // 今日解读:懒加载,用户展开才调用(控制成本);当日结果缓存不再重复请求
  const [insightOpen, setInsightOpen] = useState(false);
  const [insight, setInsight] = useState<DailyAnalysis | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState('');
  const toggleInsight = async () => {
    if (insightOpen) { setInsightOpen(false); return; }
    setInsightOpen(true);
    if (insight || insightLoading) return;
    setInsightLoading(true);
    setInsightError('');
    track('daily_ai_click', 'home');
    try {
      setInsight(await summaryApi.dailyAnalysis(today));
    } catch (e) {
      setInsightError(e instanceof Error ? e.message : '解读生成失败,请稍后重试');
    } finally {
      setInsightLoading(false);
    }
  };
  useDidShow(() => { track('home_view', 'home'); void refresh(); });

  const go = (path: RoutePath) => TAB_PAGES.includes(path)
    ? Taro.switchTab({url:`/${path}`}) : Taro.navigateTo({url:`/${path}`});
  const score = Math.round(data?.bodyScore ?? 0);
  const hasScore = data?.bodyScore != null;
  const scoreTone = !hasScore ? '暂无评估' : score >= 80 ? '状态良好' : score >= 60 ? '状态一般' : '有待提升';
  const goalProgress = Math.max(0, Math.min(100, Math.round((data?.goal?.progress ?? 0) * 100)));
  const format = (value?: number | null) => value == null ? '—' : Math.round(value).toLocaleString();

  return (
    <View className="home-page">
      <View className="home-header">
        <View className="home-header__date">
          <Text className="home-greeting">{greeting()}</Text>
          <Text className="home-date">{formatDate(today)}</Text>
          <Text className="home-week">{weekday(today)}</Text>
        </View>
      </View>

      {error && <View className="home-notice"><View className="notice-dot" /><Text>数据暂未更新，请稍后重试</Text></View>}

      <View className="dashboard-card score-card" onClick={() => go(RoutePath.Trends)}>
        <Heading title="身体状态" />
        <View className="score-main">
          <View className="score-ring" style={{ '--score': `${loading || !hasScore ? 0 : score * 3.6}deg` } as React.CSSProperties}>
            <View className="score-ring__inner">
              <Text className={`score-number${loading || !hasScore ? ' is-empty' : ''}`}>{loading || !hasScore ? '—' : score}</Text>
              <Text className="score-label">{scoreTone}</Text>
            </View>
          </View>
        </View>
        <View className="score-trend">
          <Text className="trend-copy">{hasScore ? '综合最近的记录与身体数据' : '完善身体资料并开始记录后评估'}</Text>
        </View>
        <View className="score-dimensions">
          <ScoreDimension label="能量" value={data?.energyScore} />
          <ScoreDimension label="营养" value={data?.nutritionScore} tone="amber" />
          <ScoreDimension label="恢复" value={data?.recoveryScore} tone="slate" />
        </View>
      </View>

      <View className="dashboard-card energy-card">
        <Text className="section-title">今日能量</Text>
        <View className="energy-metrics">
          <EnergyMetric label="摄入" value={format(data?.intakeCalories)} />
          <EnergyMetric label="消耗" value={format(data?.burnCalories)} />
          <EnergyMetric label="净值" value={`${(data?.netCalories ?? 0) > 0 ? '+' : ''}${format(data?.netCalories)}`} accent />
        </View>
        <View className="energy-track">
          <View className="energy-track__fill" style={{ width: `${Math.min(100, Math.max(0, ((data?.intakeCalories ?? 0) / Math.max(data?.burnCalories ?? 1, 1)) * 100))}%` }} />
          <View className="energy-track__marker" />
        </View>
        <Text className="energy-hint">绿色为已摄入进度，圆点是消耗参考线</Text>
        <View className="water-line" onClick={() => go(RoutePath.Record)}>
          <Text className="water-line__label">💧 今日水分 {data?.waterMl ? `${format(data.waterMl)} ml` : '未记录'}</Text>
          <Text className="water-line__action">去打卡</Text>
        </View>
      </View>

      <View className="dashboard-card activity-card" onClick={() => go(RoutePath.Exercise)}>
        <Heading title="今日活动" />
        <View className="activity-stats">
          <View><Text className={`activity-value${data?.steps == null ? ' is-empty' : ''}`}>{format(data?.steps)}</Text><Text className="activity-unit">步</Text></View>
          <View><Text className={`activity-value${data?.activeCalories == null ? ' is-empty' : ''}`}>{format(data?.activeCalories)}</Text><Text className="activity-unit">kcal</Text></View>
        </View>
        {data?.steps != null && (
          <View className="steps-progress">
            <View className="steps-progress__track"><View className="steps-progress__fill" style={{ width: `${Math.min(100, Math.round(((data.steps ?? 0) / 8000) * 100))}%` }} /></View>
            <Text className="steps-progress__label">{format(data.steps)} / 8,000 步</Text>
          </View>
        )}
        {data?.steps == null && data?.activeCalories == null && (
          <View className="activity-empty">
            <Text className="activity-empty__title">今日暂无活动数据</Text>
            <Text className="activity-empty__hint">去「运动-自动同步」拉取步数，或记录一次运动</Text>
          </View>
        )}
      </View>

      <View className="dashboard-card goal-card" onClick={() => Taro.navigateTo({ url: '/pages/onboarding/index' })}>
        <Heading title="当前目标" />
        <View className="goal-row"><Text className={`goal-name${data?.goal ? '' : ' is-empty'}`}>{goalLabel(data?.goal?.type)}</Text><Text className="goal-meta">{data?.goal?.durationWeeks ? `${data.goal.durationWeeks} 周计划` : ''}</Text></View>
        <View className="goal-detail"><Text className="goal-caption">{data?.goal ? '根据记录更新目标进度' : '设置目标后开始记录进度'}</Text><Text className={`goal-percent${data?.goal ? '' : ' is-empty'}`}>{data?.goal ? `${goalProgress}%` : '—'}</Text></View>
        <View className="goal-track"><View className="goal-track__fill" style={{ width: `${goalProgress}%` }} /></View>
      </View>

      <View className="dashboard-card insight-card" onClick={toggleInsight}>
        <View className="insight-head">
          <Text className="section-title">今日解读</Text>
          <View className={`insight-chevron${insightOpen ? ' is-open' : ''}`}><ArrowDown size={16} color="#94a3b8" /></View>
        </View>
        {!insightOpen && <Text className="insight-hint">结合今天的记录,给出一段身体信号解读与建议</Text>}
        {insightOpen && insightLoading && <Text className="insight-loading">正在生成解读…</Text>}
        {insightOpen && !insightLoading && insightError && <Text className="insight-error">{insightError}</Text>}
        {insightOpen && !insightLoading && insight && (
          <View className="insight-body">
            <Text className="insight-summary">{insight.summary}</Text>
            {insight.highlights.length > 0 && (
              <View className="insight-tags">
                {insight.highlights.map((h, i) => <Text key={i} className="insight-tag insight-tag--good">{h}</Text>)}
              </View>
            )}
            {insight.issues.length > 0 && (
              <View className="insight-tags">
                {insight.issues.map((s, i) => <Text key={i} className="insight-tag insight-tag--warn">{s}</Text>)}
              </View>
            )}
            {insight.actions.length > 0 && (
              <View className="insight-actions">
                {insight.actions.map((a, i) => (
                  <View key={i} className="insight-action">
                    <Text className="insight-action__title">{i + 1}. {a.title}</Text>
                    <Text className="insight-action__reason">{a.reason}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function Heading({ title }: { title: string }) {
  return <View className="card-heading"><Text>{title}</Text><ArrowRight size={14} color="#94a3b8" /></View>;
}

function ScoreDimension({ label, value, tone = 'green' }: { label: string; value?: number | null; tone?: 'green' | 'amber' | 'slate' }) {
  const empty = value == null;
  return <View className="score-dimension"><Text className="dimension-label">{label}</Text><View className="dimension-pair"><Text className={`dimension-value dimension-value--${tone}${empty ? ' is-empty' : ''}`}>{empty ? '—' : Math.round(value)}</Text><Text className="dimension-unit">%</Text></View></View>;
}

function EnergyMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  const empty = value.includes('—');
  return <View className="energy-metric"><Text className="metric-label">{label}</Text><View className="metric-pair"><Text className={`metric-value${accent ? ' metric-value--accent' : ''}${empty ? ' is-empty' : ''}`}>{value}</Text><Text className="metric-unit">kcal</Text></View></View>;
}

function formatDate(date: string) { const [, month, day] = date.split('-').map(Number); return `${month}月${day}日`; }
function greeting() { const h = new Date().getHours(); if (h < 5) return '夜深了'; if (h < 9) return '早上好'; if (h < 12) return '上午好'; if (h < 14) return '中午好'; if (h < 18) return '下午好'; return '晚上好'; }
function weekday(date: string) { return `星期${'日一二三四五六'[new Date(`${date}T00:00:00`).getDay()]}`; }
function goalLabel(type?: string) { return ({ fat_loss: '减脂', muscle_gain: '增肌', maintain: '维持', endurance: '提升体能' } as Record<string, string>)[type ?? ''] ?? '尚未设置目标'; }
