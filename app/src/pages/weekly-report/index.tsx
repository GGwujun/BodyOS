import { useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { ArrowLeft, ArrowRight, Replay } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import { summaryApi } from '@/services';
import type { WeeklyAnalysis } from '@/services/types';
import { FireOutlined, GoldCoinOutlined, BarChartOutlined, BulbOutlined } from '@taroify/icons';
import './index.scss';

/** 本地时区 YYYY-MM-DD(避免 toISOString 的 UTC 偏移把日期挪一天) */
function localDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 06 Weekly Report — 周评分 / 变化 / Wins / Issues / 下周行动,支持切换往期 */
export default function WeeklyReport() {
  // weekOffset:0=本周(最近 7 天),负数往回翻周
  const [weekOffset, setWeekOffset] = useState(0);
  const [forceCount, setForceCount] = useState(0); // 重新生成计数
  const weekStart = useMemo(() => localDateStr(-6 + weekOffset * 7), [weekOffset]);
  const weekEnd = useMemo(() => localDateStr(weekOffset * 7), [weekOffset]);

  const { data, loading, error, refresh } = useAsync<WeeklyAnalysis>(
    () => summaryApi.weeklyAnalysis(weekStart, forceCount > 0),
    [weekStart, forceCount]
  );

  const isCurrentWeek = weekOffset === 0;
  const label = `${weekStart.slice(5).replace('-', '.')} - ${weekEnd.slice(5).replace('-', '.')}`;

  return (
    <Screen className="weekly-report-page">
      <View className="week-nav">
        <ArrowLeft onClick={() => setWeekOffset((v) => v - 1)} />
        <Text className="week-label">{isCurrentWeek ? `本周 · ${label}` : label}</Text>
        {isCurrentWeek
          ? <View className="week-arrow-disabled"><ArrowRight /></View>
          : <ArrowRight onClick={() => setWeekOffset((v) => v + 1)} />}
      </View>

      {loading && (
        <View className="card">
          <Text className="fs-caption text-secondary">正在生成报告…</Text>
        </View>
      )}

      {!loading && (error || !data) && (
        <View className="error-panel">
          <BulbOutlined />
          <Text className="error-title">周报暂时无法生成</Text>
          <Text className="error-copy">{error || '数据不足，暂时无法生成报告。'}</Text>
          <Text className="retry" onClick={() => refresh()}>重新生成</Text>
          <Text className="retry" onClick={() => Taro.switchTab({ url: '/pages/record/index' })}>去记录本周数据 ›</Text>
        </View>
      )}

      {!loading && data && (
        <>
          {data.cached && (
            <View className="cache-row" onClick={() => setForceCount((v) => v + 1)}>
              <Text className="fs-mini text-secondary">{isCurrentWeek ? '本周已有缓存报告，新记录后可' : '已生成 · '}</Text>
              <Text className="fs-mini text-secondary regen-link"><Replay /> 重新生成</Text>
            </View>
          )}
          <View className="score-card">
            <Text className="fs-caption">{isCurrentWeek ? '本周评分' : '当期评分'}</Text>
            <Text className="score-value">{data.grade || '—'}</Text>
            <Text className="fs-mini">综合 {data.score} /100 · 继续保持</Text>
          </View>

          <View className="card">
            <Text className="fs-h1">关键数据</Text>
            {data.changes.length === 0 && <Text className="fs-mini text-secondary">暂无变化数据</Text>}
            {data.changes.map((c, i) => (
              <View key={i} className="report-row">
                <Text className="fs-caption"><BarChartOutlined /> {c.label}</Text>
                <Text className="text-primary">{c.value}</Text>
              </View>
            ))}
          </View>

          <View className="card win-card">
            <Text className="fs-h1 text-brand"><GoldCoinOutlined /> 做得好</Text>
            {data.wins.length === 0 && <Text className="fs-mini text-secondary">{isCurrentWeek ? '本周继续努力' : '当期暂无亮点'}</Text>}
            {data.wins.map((w, i) => (
              <Text key={i} className="fs-caption">· {w}</Text>
            ))}
          </View>

          <View className="card issue-card">
            <Text className="fs-h1 text-warning"><FireOutlined /> 需改进</Text>
            {data.issues.length === 0 && <Text className="fs-mini text-secondary">没有明显问题</Text>}
            {data.issues.map((is, i) => (
              <Text key={i} className="fs-caption">· {is}</Text>
            ))}
          </View>

          <View className="card ai-card">
            <Text className="fs-h1 text-info"><BulbOutlined /> 总结与下周行动</Text>
            {data.actions.length === 0 && <Text className="fs-mini text-secondary">保持现有节奏</Text>}
            {data.actions.map((a, i) => (
              <Text key={i} className="fs-caption">{i + 1}. {a}</Text>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
