import { View, Text } from '@tarojs/components';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import { request } from '@/services/request';
import type { WeeklyAnalysis } from '@/services/types';
import Taro from '@tarojs/taro';
import { ArrowLeft, FireOutlined, GoldCoinOutlined, BarChartOutlined, BulbOutlined } from '@taroify/icons';
import './index.scss';

/** 06 Weekly Report — 周评分 / 变化 / Wins / Issues / 下周行动 */
export default function WeeklyReport() {
  // 本周(最近 7 天)的 AI 周报
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const { data, loading, error, refresh } = useAsync<WeeklyAnalysis>(
    () => request({ url: '/ai/weekly-analysis', method: 'POST', data: { weekStart: weekStartStr }, ai: true }),
    []
  );

  if (loading) {
    return (
      <Screen className="weekly-report-page">
        <View className="report-nav"><ArrowLeft onClick={() => Taro.navigateBack()} /><Text>AI 周报</Text><Text>本周</Text></View>
        <View className="card">
          <Text className="fs-caption text-secondary">AI 正在生成本周报告…</Text>
        </View>
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen className="weekly-report-page">
        <View className="report-nav"><ArrowLeft onClick={() => Taro.navigateBack()} /><Text>AI 周报</Text><Text>本周</Text></View>
        <View className="error-panel">
          <BulbOutlined />
          <Text className="error-title">周报暂时无法生成</Text>
          <Text className="error-copy">{error || '数据不足或未配置 AI Key。'}</Text>
          <Text className="retry" onClick={() => refresh()}>重新生成</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen className="weekly-report-page">
      <View className="report-nav"><ArrowLeft onClick={() => Taro.navigateBack()} /><Text>AI 周报</Text><Text>本周</Text></View>

      <View className="score-card">
        <Text className="fs-caption">本周评分</Text>
        <Text className="score-value">{data.grade || '—'}</Text>
        <Text className="fs-mini">综合 {data.score} /100 · 继续保持</Text>
      </View>

      <View className="card metrics-card">
        <Text className="fs-h1">本周关键数据</Text>
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
        {data.wins.length === 0 && <Text className="fs-mini text-secondary">本周继续努力</Text>}
        {data.wins.map((w, i) => (
          <Text key={i} className="fs-caption">
            · {w}
          </Text>
        ))}
      </View>

      <View className="card issue-card">
        <Text className="fs-h1 text-warning"><FireOutlined /> 需改进</Text>
        {data.issues.length === 0 && <Text className="fs-mini text-secondary">没有明显问题</Text>}
        {data.issues.map((is, i) => (
          <Text key={i} className="fs-caption">
            · {is}
          </Text>
        ))}
      </View>

      <View className="card ai-card">
        <Text className="fs-h1 text-info"><BulbOutlined /> AI 总结与下周行动</Text>
        {data.actions.length === 0 && <Text className="fs-mini text-secondary">保持现有节奏</Text>}
        {data.actions.map((a, i) => (
          <Text key={i} className="fs-caption">
            {i + 1}. {a}
          </Text>
        ))}
      </View>
    </Screen>
  );
}
