import { useState } from 'react';
import { View, Text, Button, Image } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ArrowRight, Passed, ClockOutlined } from '@taroify/icons';
import Screen from '@/components/Screen';
import foodIcon from '@/assets/icons/food.png';
import runIcon from '@/assets/icons/run.png';
import dumbbellIcon from '@/assets/icons/dumbbell.png';
import scaleIcon from '@/assets/icons/scale.png';
import rulerIcon from '@/assets/icons/ruler.png';
import cameraIcon from '@/assets/icons/camera.png';
import dropIcon from '@/assets/icons/drop.png';
import recipeIcon from '@/assets/icons/recipe.png';
import { RoutePath, TAB_PAGES } from '@/constants/routes';
import WaterQuickAdd from '@/components/WaterQuickAdd';
import WeightSheet from '@/components/WeightSheet';
import { foodApi, activityApi, dataSourceApi } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useTabBarMask } from '@/hooks/useTabBarMask';
import { todayStr } from '@/utils/date';
import './index.scss';
import { sourceStatusLabel } from '@/utils/sourceStatus';
import { navigate, switchTab } from '@/utils/nav';

/**
 * 力量训练那套在**分包**里(pkg-exercise),不走 RoutePath —— 那份常量表装的是主包的核心页
 * (见 constants/routes)。写成常量而不是内联字符串:这一格和工具箱那一格指向同一个入口,
 * 以后改路径只改一处。
 */
const TRAINING_ENTRY = '/pkg-exercise/plan-view/index';

export default function Record() {
  const go = (p: RoutePath) => TAB_PAGES.includes(p)
    ? switchTab(`/${p}`)
    : navigate(`/${p}`);
  /** 三种卡片:主包路由 / 分包入口(裸路径)/ 本页弹层 */
  const openEntry = (item: { path: RoutePath | null; href?: string; sheet: string | null }) => {
    if (item.href) { navigate(item.href); return; }
    if (item.path) { go(item.path); return; }
    if (item.sheet === 'weight') setShowWeight(true);
    else setShowWater(true);
  };
  const {data,loading,error,refresh:load}=useAsync(async()=>{
    const date=todayStr();
    const [food,acts,sources]=await Promise.all([
      foodApi.listFoodLogs(date),activityApi.listActivities(date),dataSourceApi.listDataSources()
    ]);
    return {food,acts,sources};
  },[]);
  const food=data?.food;
  const acts=data?.acts;
  const sources=data?.sources;
  const availableSources=(sources ?? []).filter((s) => s.available).slice(0, 4);
  const [showWeight, setShowWeight] = useState(false);
  const [showWater, setShowWater] = useState(false);
  useTabBarMask(showWeight || showWater);
  useDidShow(() => { load(); });
  const entries = [
    { label: '饮食记录', desc: '记录你吃的食物和营养', path: RoutePath.Food, sheet: null, icon: <Image className="entry-icon__img" src={foodIcon} mode="aspectFit" />, tone: 'mint' },
    { label: '运动记录', desc: '记录运动和消耗', path: RoutePath.Exercise, sheet: null, icon: <Image className="entry-icon__img" src={runIcon} mode="aspectFit" />, tone: 'warm' },
    /* 力量训练**不是**「运动记录」的一种:那边记的是一次运动 + 消耗(有氧那种记法),
       而这里是按计划练、逐组记重量次数、下次自动渐进 —— 两个数据模型,不是同一件事的两种入口。
       之前它只在工具箱里有一格,而记录页才是用户「今天练了没」会来的地方。 */
    { label: '力量训练', desc: '按计划练 · 逐组渐进', path: null, href: TRAINING_ENTRY, sheet: null, icon: <Image className="entry-icon__img" src={dumbbellIcon} mode="aspectFit" />, tone: 'mint' },
    { label: '体重记录', desc: '记录体重和身体数据', path: null, sheet: 'weight', icon: <Image className="entry-icon__img" src={scaleIcon} mode="aspectFit" />, tone: 'warm' },
    { label: '围度记录', desc: '量腰胸臀臂腿的变化', path: RoutePath.Measure, sheet: null, icon: <Image className="entry-icon__img" src={rulerIcon} mode="aspectFit" />, tone: 'mint' },
    /* 照片以前只在「我的 → 健康工具箱」里有一格 —— 但它是**记一笔**(拍一张),
       和围度是同一种东西:记在记录页,看变化在趋势页(那边身体那一行有入口) */
    { label: '进度照片', desc: '拍一张 · 前后对比照', path: null, href: '/pages/photos/index', sheet: null, icon: <Image className="entry-icon__img" src={cameraIcon} mode="aspectFit" />, tone: 'sky' },
    { label: '喝水打卡', desc: '记录每日饮水进度', path: null, sheet: 'water', icon: <Image className="entry-icon__img" src={dropIcon} mode="aspectFit" />, tone: 'sky' },
    { label: '推荐食谱', desc: '照着吃 · 一键记一餐', path: RoutePath.Recipes, sheet: null, icon: <Image className="entry-icon__img" src={recipeIcon} mode="aspectFit" />, tone: 'warm' }
  ];

  /**
   * 喝水那一块整套(取今日量、四个常用档、自定义、清零二次确认)现在在
   * @/components/WaterQuickAdd —— 速记页记水用的是同一份(两处各写一遍,迟早两处记的水不一样)。
   * 这里只留「那一块正在请求」这一个状态,给弹层的遮罩用。
   */
  const [waterBusy, setWaterBusy] = useState(false);

  return <Screen className="record-page">
    {/* 速记页的入口。**它从 tabBar 中间那一格下来的**:那一格给了训练
        (见 constants/routes 的 RoutePath.Training)。速记本身一个字段没改,
        变的只是入口 —— 而这一页顶上就是它该在的地方:进来补水/称重的人
        和进来记饮食/运动的人,第一步是同一个决定。 */}
    <View className="record-header">
      <View className="record-header-copy">
        <Text className="record-title">今天要记录什么？</Text>
      </View>
      <Text className="record-quick" onClick={() => navigate(`/${RoutePath.QuickRecord}`)}>一键记录 ›</Text>
    </View>
    <View className="entry-list">{entries.map((item) => <View key={item.label} className="entry-card" onClick={() => openEntry(item)}>
      <View className={`entry-icon ${item.tone}`}>{item.icon}</View>
      <View className="entry-copy"><Text className="entry-name">{item.label}</Text><Text className="entry-desc">{item.desc}</Text></View>
      <ArrowRight className="entry-arrow" />
    </View>)}</View>
    <Text className="section-kicker">自动采集数据</Text>
    {loading&&<Text className="record-empty">正在加载记录和数据源…</Text>}
    {error&&<View className="record-load-error"><Text>加载失败：{error}</Text><Button className="btn btn--mini btn--secondary" onClick={()=>load()}>重新加载</Button></View>}
    {!loading && !error && availableSources.length > 0 && <View className="source-card">{availableSources.map((source, index) => {
      const connected = source.status === 'synced' || source.status === 'connected';
      return <View className="source-row" key={source.provider} onClick={() => go(RoutePath.DataSources)}><View className={`source-icon s${index}`}><ClockOutlined /></View><View className="source-copy"><Text>{source.name}</Text><Text>{sourceStatusLabel(source.status,source.lastSyncAt)}</Text></View>{connected ? <Passed className="source-ok" /> : <View className="source-empty" />}</View>;
    })}</View>}
    {!loading && !error && availableSources.length === 0 && <Text className="record-empty" onClick={() => go(RoutePath.DataSources)}>暂无数据源，点击前往连接</Text>}
    {(food?.items?.length || acts?.items?.length) ? <View className="recent-card"><Text className="recent-title">今天的记录</Text>
      {(food?.items ?? []).slice(0, 2).map((item) => <View className="recent-line" key={item.id}><Text>{mealLabel(item.meal)}</Text><Text>{Math.round(item.totalCalories)} kcal</Text></View>)}
      {(acts?.items ?? []).slice(0, 2).map((item) => <View className="recent-line" key={item.id}><Text>{item.type}</Text><Text>{Math.round(item.calories)} kcal</Text></View>)}
    </View> : null}
    {/* 体重弹层走共用组件(速记页那一份也是它)—— 以前这一页自己写了一套,
        于是「记体重」在三个地方三种长相,而且只有这一处能删掉记错的那一笔 */}
    <WeightSheet
      open={showWeight}
      onClose={() => setShowWeight(false)}
      onSaved={load}
    />

    {showWater && <View className="mask" onClick={() => !waterBusy && setShowWater(false)}><View className="weight-sheet" catchMove onClick={(e) => e.stopPropagation()}><View className="sheet-handle" /><Text className="sheet-title">喝水打卡</Text><WaterQuickAdd onBusy={setWaterBusy} /></View></View>}
  </Screen>;
}
function mealLabel(meal: string): string { return ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' } as Record<string, string>)[meal] ?? meal; }
