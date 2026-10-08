import { useEffect, useRef, useState } from 'react';
import { View, Text, Input, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ArrowRight, CartOutlined, FireOutlined, BalanceOutlined, Passed, ClockOutlined, Delete } from '@taroify/icons';
import Screen from '@/components/Screen';
import { RoutePath, TAB_PAGES } from '@/constants/routes';
import { foodApi, activityApi, dataSourceApi, bodyApi, waterApi } from '@/services';
import type { BodyMeasurement, WaterStatus } from '@/services/types';
import { useAsync } from '@/hooks/useAsync';
import { useTabBarMask } from '@/hooks/useTabBarMask';
import { toast } from '@/utils/ui';
import { todayStr, nowISO } from '@/utils/date';
import './index.scss';
import { sourceStatusLabel } from '@/utils/sourceStatus';
import { createSubmissionGate } from '@/utils/submissionGate';

export default function Record() {
  const go = (p: RoutePath) => TAB_PAGES.includes(p)
    ? Taro.switchTab({ url: `/${p}` })
    : Taro.navigateTo({ url: `/${p}` });
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
  const [weight, setWeight] = useState('');
  const [savingWeight,setSavingWeight]=useState(false);
  const weightSubmission=useRef(createSubmissionGate());
  useDidShow(() => { load(); });

  // 体重历史:弹层每次打开都拉最新(含刚保存的),失败可就地重试
  const [history, setHistory] = useState<BodyMeasurement[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const loadHistory = () => {
    setHistoryLoading(true);
    bodyApi.listBodyMeasurements()
      .then((r) => setHistory(r.items))
      .catch(() => setHistory(null))
      .finally(() => setHistoryLoading(false));
  };
  useEffect(() => {
    if (showWeight) loadHistory();
  }, [showWeight]);
  const removeHistory = async (id: string) => {
    const { confirm } = await Taro.showModal({ title: '删除记录', content: '确定删除这条体重记录吗？' });
    if (!confirm) return;
    setDeletingId(id);
    try {
      await bodyApi.deleteBodyMeasurement(id);
      setHistory((list) => list?.filter((m) => m.id !== id) ?? null);
      toast('已删除');
    } catch (e) {
      toast((e as {message?:string})?.message || '删除失败，请重试', 'error');
    } finally { setDeletingId(''); }
  };

  const saveWeight = () => weightSubmission.current(async () => {
    const value = Number(weight);
    if (!weight.trim() || !Number.isFinite(value) || value <= 0) return toast('请输入大于 0 的体重', 'none');
    setSavingWeight(true);
    try { await bodyApi.createBodyMeasurement({ measuredAt: nowISO(), weightKg: value }); toast('已记录'); setShowWeight(false); setWeight(''); setHistory(null); load(); }
    catch(e) { toast((e as {message?:string})?.message || '保存失败，请重试', 'error'); }
    finally { setSavingWeight(false); }
  });
  const entries = [
    { label: '饮食记录', desc: '记录你吃的食物和营养', path: RoutePath.Food, sheet: null, icon: <CartOutlined />, tone: 'mint' },
    { label: '运动记录', desc: '记录运动和消耗', path: RoutePath.Exercise, sheet: null, icon: <FireOutlined />, tone: 'blue' },
    { label: '体重记录', desc: '记录体重和身体数据', path: null, sheet: 'weight', icon: <BalanceOutlined />, tone: 'dark' },
    { label: '喝水打卡', desc: '记录每日饮水进度', path: null, sheet: 'water', icon: <Text className="entry-emoji">💧</Text>, tone: 'sky' },
    { label: '推荐食谱', desc: '照着吃,一键记为一餐', path: RoutePath.Recipes, sheet: null, icon: <Text className="entry-emoji">🥗</Text>, tone: 'warm' }
  ];

  // 喝水打卡弹层
  const [water, setWater] = useState<WaterStatus | null>(null);
  const [addingWater, setAddingWater] = useState(false);
  const [customMl, setCustomMl] = useState('');
  const [waterFailed, setWaterFailed] = useState(false);
  const loadWater = () => {
    setWaterFailed(false);
    waterApi.getWater(todayStr())
      .then(setWater)
      .catch(() => { setWater(null); setWaterFailed(true); });
  };
  useEffect(() => {
    if (showWater) loadWater();
  }, [showWater]);
  const addWater = (amountMl: number) => {
    if (addingWater) return;
    setAddingWater(true);
    waterApi.addWater(amountMl, todayStr())
      .then((w) => { setWater(w); toast(`+${amountMl} ml`); })
      .catch((e) => toast((e as {message?:string})?.message || '打卡失败，请重试', 'error'))
      .finally(() => setAddingWater(false));
  };
  const addCustomWater = () => {
    const v = Number(customMl);
    if (!customMl.trim() || !Number.isInteger(v) || v <= 0 || v > 2000) return toast('请输入 1-2000 的整数毫升', 'none');
    setCustomMl('');
    addWater(v);
  };
  const resetWater = async () => {
    const { confirm } = await Taro.showModal({ title: '清零重记', content: '把今天的饮水记录清零吗？' });
    if (!confirm) return;
    try { setWater(await waterApi.setWater(0, todayStr())); toast('已清零'); }
    catch (e) { toast((e as {message?:string})?.message || '操作失败', 'error'); }
  };
  const waterPct = water ? Math.min(100, Math.round((water.amountMl / Math.max(water.goalMl, 1)) * 100)) : 0;

  return <Screen className="record-page">
    <View className="record-header"><Text>今天要记录什么？</Text></View>
    <View className="entry-list">{entries.map((item) => <View key={item.label} className="entry-card" onClick={() => item.path ? go(item.path) : item.sheet === 'weight' ? setShowWeight(true) : setShowWater(true)}>
      <View className={`entry-icon ${item.tone}`}>{item.icon}</View><View className="entry-copy"><Text className="entry-name">{item.label}</Text><Text className="entry-desc">{item.desc}</Text></View><ArrowRight className="entry-arrow" />
    </View>)}</View>
    <Text className="section-kicker">自动采集数据</Text>
    {loading&&<Text className="record-empty">正在加载记录和数据源…</Text>}
    {error&&<View className="record-load-error"><Text>加载失败：{error}</Text><Button onClick={()=>load()}>重新加载</Button></View>}
    {!loading && !error && availableSources.length > 0 && <View className="source-card">{availableSources.map((source, index) => {
      const connected = source.status === 'synced' || source.status === 'connected';
      return <View className="source-row" key={source.provider} onClick={() => go(RoutePath.DataSources)}><View className={`source-icon s${index}`}><ClockOutlined /></View><View className="source-copy"><Text>{source.name}</Text><Text>{sourceStatusLabel(source.status,source.lastSyncAt)}</Text></View>{connected ? <Passed className="source-ok" /> : <View className="source-empty" />}</View>;
    })}</View>}
    {!loading && !error && availableSources.length === 0 && <Text className="record-empty" onClick={() => go(RoutePath.DataSources)}>暂无数据源，点击前往连接</Text>}
    {(food?.items?.length || acts?.items?.length) ? <View className="recent-card"><Text className="recent-title">今天的记录</Text>
      {(food?.items ?? []).slice(0, 2).map((item) => <View className="recent-line" key={item.id}><Text>{mealLabel(item.meal)}</Text><Text>{Math.round(item.totalCalories)} kcal</Text></View>)}
      {(acts?.items ?? []).slice(0, 2).map((item) => <View className="recent-line" key={item.id}><Text>{item.type}</Text><Text>{Math.round(item.calories)} kcal</Text></View>)}
    </View> : null}
    {showWeight && <View className="mask" onClick={() => !savingWeight&&setShowWeight(false)}><View className="weight-sheet" catchMove onClick={(e) => e.stopPropagation()}><View className="sheet-handle" /><Text className="sheet-title">记录体重</Text><View className="weight-input-row"><Input className="weight-input" type="digit" placeholder="请输入体重" disabled={savingWeight} value={weight} onInput={(e) => setWeight(e.detail.value)} focus/><Text className="weight-unit">kg</Text></View><Button className="sheet-save" loading={savingWeight} disabled={savingWeight} onClick={saveWeight}>{savingWeight?'正在保存…':'保存记录'}</Button><View className="history-block"><Text className="history-title">历史记录</Text>{historyLoading && <Text className="history-empty">正在加载…</Text>}{!historyLoading && history?.length === 0 && <Text className="history-empty">还没有体重记录</Text>}{history == null && !historyLoading && <Text className="history-empty" onClick={loadHistory}>历史加载失败，点击重试</Text>}<View className="history-list">{(history ?? []).map((m) => <View className="history-row" key={m.id}><Text className="history-date">{fmtMeasured(m.measuredAt)}</Text><Text className="history-value">{m.weightKg != null ? `${m.weightKg} kg` : '—'}</Text><Text className={`history-del${deletingId === m.id ? ' is-busy' : ''}`} onClick={() => deletingId !== m.id && removeHistory(m.id)}><Delete size={16} /></Text></View>)}</View></View></View></View>}

    {showWater && <View className="mask" onClick={() => !addingWater && setShowWater(false)}><View className="weight-sheet" catchMove onClick={(e) => e.stopPropagation()}><View className="sheet-handle" /><Text className="sheet-title">喝水打卡</Text>
      <View className="water-status"><Text className="water-amount">{water ? water.amountMl : '—'}</Text><Text className="water-goal">/ {water?.goalMl ?? 1500} ml</Text>{water != null && water.amountMl >= water.goalMl && water.goalMl > 0 && <Text className="water-done">已达标</Text>}</View>
      {waterFailed && <Text className="history-empty" onClick={loadWater}>今日水量加载失败，点击重试</Text>}
      <View className="water-bar"><View className="water-bar__fill" style={{ width: `${waterPct}%` }} /></View>
      <Text className="water-pct">今日目标已完成 {waterPct}%</Text>
      <View className="water-chips">{[100, 200, 250, 300].map((ml) => <Text key={ml} className={`water-chip${addingWater ? ' is-busy' : ''}`} onClick={() => addWater(ml)}>+{ml} ml</Text>)}</View>
      <View className="water-custom"><Input className="water-custom-input" type="number" placeholder="自定义毫升数" value={customMl} onInput={(e) => setCustomMl(e.detail.value)} /><Button size="mini" disabled={addingWater} onClick={addCustomWater}>添加</Button></View>
      {water != null && water.amountMl > 0 && <Text className="water-reset" onClick={resetWater}>记错了？清零重记</Text>}
    </View></View>}
  </Screen>;
}
function mealLabel(meal: string): string { return ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' } as Record<string, string>)[meal] ?? meal; }
function fmtMeasured(iso: string): string { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
