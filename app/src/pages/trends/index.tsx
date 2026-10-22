import { useEffect, useState } from 'react';
import { View, Text, Picker, Image } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ChartTrendingOutlined, BarChartOutlined, BulbOutlined } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import LineChart from '@/components/LineChart';
import { trendsApi } from '@/services';
import { RoutePath } from '@/constants/routes';
import dumbbellIcon from '@/assets/icons/dumbbell.png';
import { request } from '@/services/request';
import { todayStr } from '@/utils/date';
import { valueText } from '@/utils/chart';
import { loadTrainingProgress, progressView, type TrainingProgress } from '@/utils/training-progress';
import { avgMacros, anyMacros, energyShare, macroLine, shareLine, proteinShortBy } from '@/utils/nutrition';
import type { DailyAnalysis } from '@/services/types';
import './index.scss';
import { THEME } from '@/constants/theme';
import { navigate, switchTab } from '@/utils/nav';

/** 训练统计页 —— 趋势页训练那一块的「看全部」 */
const TRAINING_STATS_URL = '/pkg-exercise/stats/index';

/** 身体那几条下钻 —— 这一页只给读数,细节各自有页 */
const BODY_LINKS: { label: string; url: string }[] = [
  { label: '体重目标与曲线', url: '/pages/weight/index' },
  { label: '围度', url: '/pages/measure/index' },
  { label: '进度照片', url: '/pages/photos/index' }
];

const RANGES = [7, 30, 90] as const;
export default function Trends() {
  const [range, setRange] = useState<number>(7);
  const [section, setSection] = useState<'trend'|'data'|'analysis'>('trend');
  const { data, loading, error, refresh } = useAsync(() => trendsApi.getTrends(range), [range]);
  /**
   * 训练那半边留下的长程快照(见 utils/training-progress.ts)。
   * **这一格是这一页以前缺的那一半**:趋势 = 我的变化,而「我练了这么久有没有变」
   * 原先在整页里一格都没有 —— 只有体重、步数、评分。练完的人来这一页找不到训练,
   * 得先想「我的 → 健康工具箱 → 训练统计」才摸得到,那是三层。
   */
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  // tab 页常驻内存:每次切回趋势 tab 重拉,保证记录后数据即时可见
  useDidShow(() => { void refresh(); setProgress(loadTrainingProgress()); });
  // 今日解读:切到「分析」tab 才请求(懒加载),按天失效,失败可重试
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null);
  const [analysisDate, setAnalysisDate] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(false);
  const loadAnalysis = () => {
    setAnalysisLoading(true); setAnalysisError(false);
    fetchAnalysis().then((r) => { setAnalysis(r); setAnalysisDate(todayStr()); })
      .catch(() => setAnalysisError(true))
      .finally(() => setAnalysisLoading(false));
  };
  useEffect(() => {
    if (section !== 'analysis' || analysisLoading) return;
    if (analysis && analysisDate === todayStr()) return;
    loadAnalysis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);
  const weights = data?.weights ?? [];
  const summaries = data?.summaries ?? [];
  const stats = data?.stats;
  const change = stats?.weightChange;
  /** 曲线两端那两行读数(设计稿把起止日期和体重摆在卡片底部) */
  const firstWeight = weights[0];
  const lastWeight = weights[weights.length - 1];
  /**
   * 体重变化该标绿还是标黄,跟目标方向走。
   * 以前固定「掉秤=好」:增肌的人涨了 2kg 是达成目标,却被标成警告。
   */
  const goalType = data?.goal?.type;
  const changeTone = change == null || !goalType
    ? 'muted'
    : goalType === 'muscle_gain'
      ? (change >= 0 ? 'good' : 'warn')
      : goalType === 'maintain'
        ? (Math.abs(change) <= 0.5 ? 'good' : 'warn')
        : goalType === 'endurance'
          ? 'muted'
          : (change <= 0 ? 'good' : 'warn');
  const stepsPoints = summaries.filter((s) => s.steps > 0).map((s) => ({ label: s.date.slice(5), value: s.steps }));
  const latestSteps = stepsPoints.length ? stepsPoints[stepsPoints.length - 1].value : null;
  const avgSteps = stepsPoints.length ? Math.round(stepsPoints.reduce((sum, p) => sum + p.value, 0) / stepsPoints.length) : null;
  /**
   * 饮食:只算**有记录的那几天**。
   * 没记的那天 intakeCalories 是 0 —— 把它算进日均,等于替用户记了一天的「没吃东西」,
   * 数字会低得离谱(吃 3 天、休 4 天 → 日均被摊成实际的三分之一)。
   * 所以卡片上明说「N 天有记录」,让人知道这个均数是拿几天算的。
   */
  const intakeDays = summaries.filter((s) => s.intakeCalories > 0);
  const intakePoints = intakeDays.map((s) => ({ label: s.date.slice(5), value: s.intakeCalories }));
  const avgOf = (nums: number[]) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);
  const avgIntake = avgOf(intakePoints.map((p) => p.value));
  const avgBurn = avgOf(intakeDays.map((s) => s.burnCalories ?? 0).filter((v) => v > 0));
  const avgNet = avgOf(intakeDays.filter((s) => s.netCalories != null).map((s) => s.netCalories as number));
  /**
   * 三大营养素:分母和热量那块**同一份**(有记录的那几天),不另算一个窗口 ——
   * 同一张卡上「日均摄入 1800」和「日均蛋白 82g」必须是我同几天吃出来的数。
   * 手动记的那种(只填名字和热量)三条克数都是 0,一整天都这么记就干脆不显示,
   * 免得摆出一份「蛋白 0g」的假账(见 utils/nutrition.anyMacros)。
   */
  /* 睡眠:只平均记过的那几晚(0 是没记,不是睡了 0 小时) */
  const sleepDays = summaries.filter((s) => s.sleepMinutes > 0);
  const avgSleep = sleepDays.length
    ? (sleepDays.reduce((sum, s) => sum + s.sleepMinutes, 0) / sleepDays.length / 60).toFixed(1)
    : null;
  const macroDays = intakeDays.filter((s) => anyMacros([s.nutrition]));
  const avgMacro = avgMacros(macroDays.map((s) => s.nutrition), macroDays.length);
  const share = avgMacro ? energyShare(avgMacro) : null;
  const proteinShort = proteinShortBy(avgMacro, data?.macroTarget ?? null);
  return <Screen className="trends-page">
    {/* 页头就是一条分段开关 —— 这一页的三个问题(趋势/数据/分析)比一句
        「看见变化」有用,而原生导航已经写着「趋势」了,不再重复一个标题 */}
    <View className="section-tabs">{[['trend','趋势'],['data','数据'],['analysis','分析']].map(([key,label]) => <Text key={key} className={section===key?'active':''} onClick={() => setSection(key as typeof section)}>{label}</Text>)}</View>
    <View className="range-tabs">{RANGES.map((value) => <Text key={value} className={range===value?'active':''} onClick={() => setRange(value)}>{value}天</Text>)}<Picker mode="selector" range={Array.from({length:90},(_,i)=>`${i+1}天`)} value={range-1} onChange={e=>setRange(Number(e.detail.value)+1)}><Text className={[7,30,90].includes(range)?'':'active'}>{[7,30,90].includes(range)?'自定义':`${range}天`}</Text></Picker></View>
    {loading && <Text className="status-hint">正在加载趋势…</Text>}
    {error && <Text className="status-hint" onClick={() => refresh()}>加载失败，点击重试</Text>}

    {section === 'trend' && !loading && !error && <>
      <View className="metric-card main-chart weight-trend-card">
        <View className="metric-head">
          <View>
            <Text className="metric-label">体重 (kg)</Text>
            <Text className="metric-value weight-trend-value">{stats?.currentWeight?.toFixed(1) ?? '—'}</Text>
          </View>
          <Text className={`metric-delta ${changeTone}`}>{change==null?'—':`${change>0?'+':''}${change.toFixed(1)}`}</Text>
        </View>
        {/* 这一页不画体重目标线:接口不给目标(那是体重页自己从档案推的),而且它的进度环
            就在这一页的下钻里 —— 曲线只负责「变没变」,「还差多少」去那儿看 */}
        {weights.length ? <LineChart canvasId="weight-trend" height={180} color={THEME.primary} unit="kg" hint={false} points={weights.map((w) => ({label:w.date.slice(5),value:w.weightKg}))}/> : <Text className="chart-placeholder">所选时间内暂无体重记录</Text>}
        {/* 曲线两端各一句:左起、右止。日期 + 体重比刻度更直接 ——
            图上那两个数已经画在纵轴上了,底部再写一遍才答得了「从哪天到哪天」 */}
        {firstWeight && lastWeight && <View className="weight-trend-foot">
          <Text className="weight-trend-foot__item">{firstWeight.date.slice(5)} · {valueText(firstWeight.weightKg)}kg</Text>
          <Text className="weight-trend-foot__item">{lastWeight.date.slice(5)} · {valueText(lastWeight.weightKg)}kg</Text>
        </View>}
        {/* 平台期(纯规则判定,服务端算好):减脂的人盯着一条不动的曲线最容易泄气,
            这里把「为什么不掉」变成一条说得出口的规则和两个可试的抓手 */}
        {data?.plateau && <Text className="weight-plateau">
          近 {data.plateau.days} 天体重基本没动（{data.plateau.changeKg > 0 ? '+' : ''}{data.plateau.changeKg}kg）—— 平台期很常见，可以试着调整饮食热量或训练强度
        </Text>}
        {weights.length === 0 && <Text className="chart-action" onClick={() => switchTab(`/${RoutePath.Record}`)}>去记录体重 ›</Text>}
        {weights.length === 1 && <Text className="chart-hint">已有 1 次记录，再记一次就能看到变化曲线</Text>}
      </View>
      {/* 训练 —— 挨着体重摆:这一页答的是「我有没有变」,而变的不只是秤上的数。
          时间档跟这一页那排 7/30/90 天走,不另立一套口径(见 utils/training-progress.ts) */}
      <TrainingCard progress={progress} range={range} />
      {/* 饮食 —— 这一页原先只摆了体重、步数、评分,而「吃」在任何地方都没有曲线:
          首页那行能量只说今天,记录页只说刚刚记了什么。接口一直是把每天的
          intakeCalories / netCalories 一起返回的,只是没人用 —— 一天吃超没吃超,
          是减脂的人打开趋势页最想先看到的那件事 */}
      <View className="metric-card main-chart"><View className="metric-head"><View><Text className="metric-label">热量 (kcal)</Text><Text className="metric-value">{avgIntake ?? '—'}</Text></View>{avgNet != null && <Text className="muted">日均净 {avgNet > 0 ? '+' : ''}{avgNet}</Text>}</View>
        {/* 每天吃超没吃超,看的是曲线和那条目标线之间的位置 —— 目标来自服务端引擎(按体重和目标类型算) */}
        {intakePoints.length ? <LineChart canvasId="intake-trend" height={160} color={THEME.warning} unit="kcal" points={intakePoints} target={data?.macroTarget?.calories ? { value: data.macroTarget.calories, label: '目标' } : null}/> : <Text className="chart-placeholder">所选时间内暂无饮食记录</Text>}
        {intakePoints.length === 0 && <Text className="chart-action" onClick={() => switchTab(`/${RoutePath.Record}`)}>去记一餐 ›</Text>}
        {intakePoints.length > 0 && <Text className="chart-hint">日均摄入 {avgIntake} · 日均消耗 {avgBurn ?? '—'}{intakePoints.length < summaries.length ? `（${intakePoints.length} 天有记录）` : ''}</Text>}
        {/* 三大营养素 —— 热量一个数答不了「蛋白够不够、油是不是放多了」,
            而克数每笔记录里一直有(食物库、服务端按天汇总都有),只是从没显示过。
            目标那半来自服务端(引擎按体重和目标类型算的),这一页不自己编一个 */}
        {avgMacro && share && <View className="macro-row">
          <View className="macro-bar">
            {([['p', share.proteinG], ['c', share.carbG], ['f', share.fatG]] as const).map(([k, pct]) => (
              <View key={k} className={`macro-bar__seg is-${k}`} style={{ width: `${pct}%` }} />
            ))}
          </View>
          <Text className="macro-row__line">{macroLine(avgMacro)}{macroDays.length < intakePoints.length ? `（按 ${macroDays.length} 天有克数的记录算）` : ''}</Text>
          <Text className="macro-row__share">{shareLine(share)}</Text>
          {proteinShort != null && <Text className="macro-row__tip" onClick={() => navigate('/pages/food-rank/index?tab=protein')}>
            蛋白离每天 {data?.macroTarget?.proteinG}g 的目标还差约 {proteinShort}g —— 看高蛋白食物 ›
          </Text>}
        </View>}
      </View>
      <View className="metric-card main-chart"><View className="metric-head"><View><Text className="metric-label">步数 (步)</Text><Text className="metric-value">{latestSteps ?? '—'}</Text></View><Text className="muted">日均 {avgSteps ?? '—'}</Text></View>
        {stepsPoints.length ? <LineChart canvasId="steps-trend" height={160} color={THEME.sky} unit="步" points={stepsPoints}/> : <Text className="chart-placeholder">所选时间内暂无步数数据</Text>}
        {stepsPoints.length === 0 && <Text className="chart-action" onClick={() => navigate(`/${RoutePath.DataSources}`)}>去连接数据源自动同步 ›</Text>}
      </View>
      {/* 身体数据的三条下钻。这一页给的是读数,要看细节各自有页 ——
          而它们以前只在「我的 → 健康工具箱」里有一格(进度照片连那儿都是唯一入口),
          用户在这一页看到体重曲线想去改目标,却没有下一步可走 */}
      <View className="body-links">
        {BODY_LINKS.map((l) => (
          <Text className="body-link" key={l.url} onClick={() => navigate(l.url)}>{l.label}</Text>
        ))}
      </View>
    </>}
    {section === 'data' && !loading && !error && <>
      <View className="mini-grid"><View className="metric-card"><ChartTrendingOutlined/><Text className="mini-label">身体评分</Text><Text className="mini-value">{stats?.avgScore != null ? Math.round(stats.avgScore) : '—'}</Text><Text className="good">近 {range} 天均分</Text></View><View className="metric-card"><BarChartOutlined/><Text className="mini-label">记录天数</Text><Text className="mini-value">{stats?.recordDays ?? '—'}</Text><Text className="muted">持续积累数据</Text></View><View className="metric-card"><ChartTrendingOutlined/><Text className="mini-label">平均睡眠</Text><Text className="mini-value">{avgSleep ?? '—'}</Text><Text className="muted">{sleepDays.length ? `小时 · ${sleepDays.length} 晚有记录` : '速记页记睡眠'}</Text></View></View>
      <View className="metric-card data-list"><Text className="card-title">每日 Body Score</Text>{!summaries.length && <Text className="data-empty">所选时间内暂无评分记录</Text>}{[...summaries].reverse().map(item => <View key={item.date}><Text>{item.date.slice(5)}</Text><Text>{item.bodyScore ?? '—'}</Text></View>)}</View>
    </>}
    {section === 'analysis' && <View className="metric-card insight"><BulbOutlined/><Text className="card-title">今日解读</Text>{analysisLoading && !analysis && <Text>正在结合你的身体数据生成分析…</Text>}{analysisError && !analysis && <Text onClick={() => loadAnalysis()}>分析失败，点击重试</Text>}{analysis && <Text>{analysis.summary}</Text>}{analysis?.actions?.map(a => <Text className="action" key={a.title}>{a.title}</Text>)}</View>}
  </Screen>;
}
/**
 * 训练那一块。**没练过的人也要有一句话**:空着不显示的话,这一页对他就少了一半,
 * 而他不知道该去哪儿开始 —— 所以给一句「还没有训练记录」加一条去计划页的路。
 * (这里不摆「今天练什么」:那是首页那张卡的事,同一句话在一页上说两遍就成了两个入口)
 */
function TrainingCard({ progress, range }: { progress: TrainingProgress | null; range: number }) {
  const openStats = () => navigate(TRAINING_STATS_URL);
  if (!progress) {
    return <View className="metric-card train-empty-card">
      <Text className="card-title">力量训练</Text>
      {/* 空态是一块虚线面板:它说的是「这里以后会长出东西」,而不是一条报错 */}
      <View className="train-empty">
        <View className="train-empty__icon">
          <Image className="train-empty__icon-img" src={dumbbellIcon} mode="aspectFit" />
        </View>
        <Text className="train-empty__title">暂无记录</Text>
        <Text className="train-empty__hint">还没有力量训练记录，去添加一次吧</Text>
      </View>
      <View className="train-empty__action" onClick={() => navigate('/pkg-exercise/plan-view/index')}>去安排一周训练 ›</View>
    </View>;
  }
  const pv = progressView(progress, range, todayStr());
  return <View className="metric-card train-card">
    <View className="metric-head">
      <View>
        <Text className="metric-label">力量训练</Text>
        <Text className="train-recent">{pv.recent}</Text>
      </View>
      {!!pv.delta && <Text className="muted">{pv.delta}</Text>}
    </View>
    <Text className="train-total">{pv.total}{pv.last ? ` · 最近一次 ${pv.last}` : ''}</Text>
    {pv.lifts.length > 0 && <View className="train-lifts">
      <Text className="train-lifts__title">最近的纪录</Text>
      {pv.lifts.map((l) => <View className="train-lift" key={l.name}>
        <Text className="train-lift__name">{l.name}</Text>
        <Text className="train-lift__value">估 1RM {l.kg}kg</Text>
        <Text className="train-lift__when">{l.date.slice(5)}</Text>
      </View>)}
    </View>}
    <Text className="chart-action" onClick={openStats}>看完整的训练统计 ›</Text>
  </View>;
}

async function fetchAnalysis(): Promise<DailyAnalysis> { return request<DailyAnalysis>({url:'/ai/daily-analysis',method:'POST',data:{date:todayStr()},ai:true}); }
