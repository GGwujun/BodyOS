import { useState } from 'react';
import { View, Text, Picker } from '@tarojs/components';
import { ChartTrendingOutlined, BarChartOutlined, BulbOutlined } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import LineChart from '@/components/LineChart';
import { trendsApi } from '@/services';
import { request } from '@/services/request';
import { todayStr } from '@/utils/date';
import type { DailyAnalysis } from '@/services/types';
import './index.scss';

const RANGES = [7, 30, 90] as const;
export default function Trends() {
  const [range, setRange] = useState<number>(7);
  const [section, setSection] = useState<'trend'|'data'|'analysis'>('trend');
  const { data, loading, error, refresh } = useAsync(() => trendsApi.getTrends(range), [range]);
  const { data: analysis, error: analysisError, refresh: retryAnalysis } = useAsync<DailyAnalysis>(() => fetchAnalysis(), []);
  const weights = data?.weights ?? [];
  const summaries = data?.summaries ?? [];
  const stats = data?.stats;
  const change = stats?.weightChange;
  return <Screen className="trends-page">
    <View className="section-tabs">{[['trend','趋势'],['data','数据'],['analysis','分析']].map(([key,label]) => <Text key={key} className={section===key?'active':''} onClick={() => setSection(key as typeof section)}>{label}</Text>)}</View>
    <View className="range-tabs">{RANGES.map((value) => <Text key={value} className={range===value?'active':''} onClick={() => setRange(value)}>{value}天</Text>)}<Picker mode="selector" range={Array.from({length:90},(_,i)=>`${i+1}天`)} value={range-1} onChange={e=>setRange(Number(e.detail.value)+1)}><Text>{[7,30,90].includes(range)?'自定义':`${range}天`}</Text></Picker></View>
    {loading && <Text className="status-hint">正在加载趋势…</Text>}
    {error && <Text className="status-hint" onClick={() => refresh()}>加载失败，点击重试</Text>}

    {section === 'trend' && !loading && !error && <>
      <View className="metric-card main-chart"><View className="metric-head"><View><Text className="metric-label">体重 (kg)</Text><Text className="metric-value">{stats?.currentWeight?.toFixed(1) ?? '—'}</Text></View><Text className={change==null?'muted':change<=0?'good':'warn'}>{change==null?'—':`${change>0?'+':''}${change.toFixed(1)}`}</Text></View>
        {weights.length ? <LineChart canvasId="weight-trend" height={180} color="#10b981" points={weights.map((w) => ({label:w.date.slice(5),value:w.weightKg}))}/> : <Text className="chart-placeholder">所选时间内暂无体重记录</Text>}
      </View>
    </>}
    {section === 'data' && !loading && !error && <>
      <View className="mini-grid"><View className="metric-card"><ChartTrendingOutlined/><Text className="mini-label">Body Score</Text><Text className="mini-value">{stats?.avgScore ?? '—'}</Text><Text className="good">近 {range} 天均分</Text></View><View className="metric-card"><BarChartOutlined/><Text className="mini-label">记录天数</Text><Text className="mini-value">{stats?.recordDays ?? '—'}</Text><Text className="muted">持续积累数据</Text></View></View>
      <View className="metric-card data-list"><Text className="card-title">每日 Body Score</Text>{!summaries.length && <Text className="data-empty">所选时间内暂无评分记录</Text>}{[...summaries].reverse().map(item => <View key={item.date}><Text>{item.date.slice(5)}</Text><Text>{item.bodyScore ?? '—'}</Text></View>)}</View>
    </>}
    {section === 'analysis' && <View className="metric-card insight"><BulbOutlined/><Text className="card-title">今日解读</Text>{analysisError ? <Text onClick={() => retryAnalysis()}>分析失败，点击重试</Text> : <Text>{analysis?.summary ?? '正在结合你的身体数据生成分析…'}</Text>}{analysis?.actions?.map(a => <Text className="action" key={a.title}>{a.title}</Text>)}</View>}
  </Screen>;
}
async function fetchAnalysis(): Promise<DailyAnalysis> { return request<DailyAnalysis>({url:'/ai/daily-analysis',method:'POST',data:{date:todayStr()},ai:true}); }
