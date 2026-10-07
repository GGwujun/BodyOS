import { useRef, useState } from 'react';
import { View, Text, Input, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ArrowRight, CartOutlined, FireOutlined, BalanceOutlined, Passed, ClockOutlined } from '@taroify/icons';
import Screen from '@/components/Screen';
import { RoutePath } from '@/constants/routes';
import { foodApi, activityApi, dataSourceApi, bodyApi } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useTabBarMask } from '@/hooks/useTabBarMask';
import { toast } from '@/utils/ui';
import { todayStr, nowISO } from '@/utils/date';
import './index.scss';
import { sourceStatusLabel } from '@/utils/sourceStatus';
import { createSubmissionGate } from '@/utils/submissionGate';

export default function Record() {
  const go = (p: RoutePath) => Taro.navigateTo({ url: `/pages/${p.split('/')[1]}/index` });
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
  const [showWeight, setShowWeight] = useState(false);
  useTabBarMask(showWeight);
  const [weight, setWeight] = useState('');
  const [savingWeight,setSavingWeight]=useState(false);
  const weightSubmission=useRef(createSubmissionGate());
  useDidShow(() => { load(); });
  const saveWeight = () => weightSubmission.current(async () => {
    const value = Number(weight);
    if (!weight.trim() || !Number.isFinite(value) || value <= 0) return toast('请输入大于 0 的体重', 'none');
    setSavingWeight(true);
    try { await bodyApi.createBodyMeasurement({ measuredAt: nowISO(), weightKg: value }); toast('已记录'); setShowWeight(false); setWeight(''); load(); }
    catch(e) { toast((e as {message?:string})?.message || '保存失败，请重试', 'error'); }
    finally { setSavingWeight(false); }
  });
  const entries = [
    { label: '饮食记录', desc: '记录你吃的食物和营养', path: RoutePath.Food, icon: <CartOutlined />, tone: 'mint' },
    { label: '运动记录', desc: '记录运动和消耗', path: RoutePath.Exercise, icon: <FireOutlined />, tone: 'blue' },
    { label: '体重记录', desc: '记录体重和身体数据', path: null, icon: <BalanceOutlined />, tone: 'dark' }
  ];
  return <Screen className="record-page">
    <View className="record-header"><Text>今天要记录什么？</Text></View>
    <View className="entry-list">{entries.map((item) => <View key={item.label} className="entry-card" onClick={() => item.path ? go(item.path) : setShowWeight(true)}>
      <View className={`entry-icon ${item.tone}`}>{item.icon}</View><View className="entry-copy"><Text className="entry-name">{item.label}</Text><Text className="entry-desc">{item.desc}</Text></View><ArrowRight className="entry-arrow" />
    </View>)}</View>
    <Text className="section-kicker">自动采集数据</Text>
    {loading&&<Text className="record-empty">正在加载记录和数据源…</Text>}
    {error&&<View className="record-load-error"><Text>加载失败：{error}</Text><Button onClick={()=>load()}>重新加载</Button></View>}
    <View className="source-card">{(sources ?? []).filter((s) => s.available).slice(0, 4).map((source, index) => {
      const connected = source.status === 'synced' || source.status === 'connected';
      return <View className="source-row" key={source.provider} onClick={() => go(RoutePath.DataSources)}><View className={`source-icon s${index}`}><ClockOutlined /></View><View className="source-copy"><Text>{source.name}</Text><Text>{sourceStatusLabel(source.status,source.lastSyncAt)}</Text></View>{connected ? <Passed className="source-ok" /> : <View className="source-empty" />}</View>;
    })}{sources?.length === 0 && <Text className="record-empty">暂无数据源，点击前往连接</Text>}</View>
    {(food?.items?.length || acts?.items?.length) ? <View className="recent-card"><Text className="recent-title">今天的记录</Text>
      {(food?.items ?? []).slice(0, 2).map((item) => <View className="recent-line" key={item.id}><Text>{mealLabel(item.meal)}</Text><Text>{Math.round(item.totalCalories)} kcal</Text></View>)}
      {(acts?.items ?? []).slice(0, 2).map((item) => <View className="recent-line" key={item.id}><Text>{item.type}</Text><Text>{Math.round(item.calories)} kcal</Text></View>)}
    </View> : null}
    {showWeight && <View className="mask" onClick={() => !savingWeight&&setShowWeight(false)}><View className="weight-sheet" catchMove onClick={(e) => e.stopPropagation()}><View className="sheet-handle" /><Text className="sheet-title">记录体重</Text><View className="weight-input-row"><Input className="weight-input" type="digit" placeholder="请输入体重" disabled={savingWeight} value={weight} onInput={(e) => setWeight(e.detail.value)} focus/><Text className="weight-unit">kg</Text></View><Button className="sheet-save" loading={savingWeight} disabled={savingWeight} onClick={saveWeight}>{savingWeight?'正在保存…':'保存记录'}</Button></View></View>}
  </Screen>;
}
function mealLabel(meal: string): string { return ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' } as Record<string, string>)[meal] ?? meal; }
