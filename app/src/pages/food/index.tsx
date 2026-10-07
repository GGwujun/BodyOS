import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, Textarea, Button, Input } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { FOOD_CATEGORIES, FOOD_LIBRARY } from '@/data/foods';
import type { FoodEntry } from '@/data/foods';
import { foodApi } from '@/services';
import { track } from '@/services/analytics';
import type { FoodItem, FoodLog, FrequentFood } from '@/services/types';
import { confirmDelete, toast } from '@/utils/ui';
import { todayStr } from '@/utils/date';
import { fileToBase64 } from '@/utils/file';
import { Photograph, BulbOutlined } from '@taroify/icons';
import './index.scss';

type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
const MEALS: { key: Meal; label: string }[] = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
  { key: 'snack', label: '加餐' }
];

type ParseState = 'idle' | 'parsing' | 'need_confirm' | 'failed';

export default function Food() {
  const today = todayStr();
  const [meal, setMeal] = useState<Meal>('breakfast');
  const [mode, setMode] = useState<'ai' | 'library' | 'manual' | 'frequent'>('ai');
  const [source, setSource] = useState<FoodLog['source']>('manual');
  const [text, setText] = useState('');
  const [state, setState] = useState<ParseState>('idle');
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<FoodItem[]>([]);
  const [resultConf, setResultConf] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualKcal, setManualKcal] = useState('');
  const [editId, setEditId] = useState<string | null>(null);

  // 常用食物库:首次切到该 tab 懒加载(近 30 天频次聚合)
  const [frequent, setFrequent] = useState<FrequentFood[] | null>(null);
  useEffect(() => {
    if (mode !== 'frequent' || frequent !== null) return;
    foodApi.listFrequentFoods()
      .then((r) => setFrequent(r.items))
      .catch(() => setFrequent([]));
  }, [mode, frequent]);

  // 内置食物库:本地静态数据,搜索 + 分类筛选
  const [libKw, setLibKw] = useState('');
  const [libCat, setLibCat] = useState<string>('全部');
  const libFiltered = useMemo(() => {
    const kw = libKw.trim();
    return FOOD_LIBRARY.filter((f) => (libCat === '全部' || f.category === libCat) && (!kw || f.name.includes(kw)));
  }, [libKw, libCat]);
  const addFromLibrary = (f: FoodEntry) => {
    setSource('manual');
    setResultConf(null);
    setItems((prev) => [...prev, { name: f.name, amount: f.amount, calories: f.calories, proteinG: f.proteinG, carbG: f.carbG, fatG: f.fatG }]);
    setState('need_confirm');
  };

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const r = await foodApi.listFoodLogs(today);
      setLogs(r.items);
      setLogsError('');
    } catch (e) {
      setLogsError((e as { message?: string })?.message || '加载失败');
    } finally {
      setLogsLoading(false);
    }
  }, [today]);

  usePullDownRefresh(async () => {
    await loadLogs();
    Taro.stopPullDownRefresh();
  });

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const parse = async (useImage = false) => {
    if (!useImage && !text.trim()) {
      toast('请输入食物描述', 'none');
      return;
    }
    setState('parsing');
    setErrorMsg('');
    track('ai_food_parse_start', 'ai', { mode: useImage ? 'image' : 'text' });
    try {
      let r;
      if (useImage) {
        const media = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] });
        const file = media.tempFiles[0].tempFilePath;
        const base64 = await fileToBase64(file);
        r = await foodApi.parseFood({ image: base64 });
      } else {
        r = await foodApi.parseFood({ text });
      }
      setItems(r.items);
      setSource(useImage ? 'ai_image' : 'ai_text');
      setResultConf(typeof r.confidence === 'number' ? r.confidence : null);
      setState('need_confirm');
    } catch (e) {
      setErrorMsg((e as { message?: string })?.message || '识别失败');
      setState('failed');
    }
  };

  const addManual = () => {
    const kcal = Number(manualKcal);
    if (!manualName.trim() || !Number.isFinite(kcal) || kcal <= 0) {
      toast('请填写名称和热量', 'none');
      return;
    }
    setItems((prev) => [
      ...prev,
      { name: manualName, amount: '1 份', calories: kcal, proteinG: 0, carbG: 0, fatG: 0 }
    ]);
    setManualName('');
    setManualKcal('');
    setManualOpen(false);
    setErrorMsg('');
    setState('need_confirm');
  };

  const updateItem = (i: number, patch: Partial<FoodItem>) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };
  const removeItem = (i: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  };

  const totalKcal = items.reduce((s, i) => s + (Number(i.calories) || 0), 0);

  const save = async () => {
    if (saving) return;
    if (items.length === 0) { toast('请先添加至少一种食物', 'none'); return; }
    if (items.some(item => !item.name.trim() || !Number.isFinite(item.calories) || item.calories < 0)) {
      toast('请检查食物名称和热量', 'none'); return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      if (editId) {
        await foodApi.updateFoodLog(editId, { meal, items });
        toast('已更新');
      } else {
        await foodApi.createFoodLog({ meal, items, source });
        track('ai_food_parse_confirm', 'ai', { items: items.length });
        toast('已保存');
      }
      setState('idle');
      setEditId(null);
      setText('');
      setItems([]);
      await loadLogs();
    } catch (e) {
      setErrorMsg((e as { message?: string })?.message || '保存失败');
      toast('保存失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  };

  /** 编辑已保存的记录:载入本餐编辑器 */
  const onEditLog = (log: FoodLog) => {
    setEditId(log.id);
    setMeal(log.meal);
    setSource(log.source);
    setItems(log.items.map((it) => ({ ...it })));
    setState('need_confirm');
  };
  const cancelEdit = () => {
    setEditId(null);
    setItems([]);
    setState('idle');
  };

  const onDeleteLog = async (id: string) => {
    const ok = await confirmDelete('删除这条记录?', '删除后今日能量汇总将重新计算。');
    if (!ok) return;
    try {
      await foodApi.deleteFoodLog(id);
      await loadLogs();
      toast('已删除');
    } catch (e) {
      toast('删除失败', 'error');
    }
  };

  return (
    <Screen className="food-page">
      <View className="mode-tabs">{([{key:'ai',label:'快速识别'},{key:'library',label:'食物库'},{key:'frequent',label:'常用食物'},{key:'manual',label:'手动'}] as const).map(tab => <Text key={tab.key} className={mode === tab.key ? 'active' : ''} onClick={() => setMode(tab.key)}>{tab.label}</Text>)}</View>

      {/* 餐次选择 */}
      <View className="meal-tabs">
        {MEALS.map((m) => (
          <Text
            key={m.key}
            className={`meal-tab ${meal === m.key ? 'active' : ''}`}
            onClick={() => setMeal(m.key)}
          >
            {m.label}
          </Text>
        ))}
      </View>

      {/* 文本输入 */}
      {mode === 'ai' && <View className="food-prompt">
        <View className="prompt-title"><BulbOutlined /><Text>说说你吃了什么</Text></View>
        <Textarea
          className="food-input"
          placeholder="例如:一碗牛肉面、一个煎蛋、一杯豆浆"
          value={text}
          onInput={(e) => setText(e.detail.value)}
        />
        <View className="row between mt-3" style={{ gap: 8 }}>
          <Button className="photo-btn" size="mini" onClick={() => parse(true)}>
            <Photograph /> 拍照识别
          </Button>
          <Button
            className="parse-btn"
            size="mini"
            loading={state === 'parsing'}
            onClick={() => parse(false)}
          >
            立即识别
          </Button>
        </View>
      </View>}

      {mode === 'library' && <View className="card">
        <Text className="fs-h1">食物库</Text>
        <Text className="fs-mini text-secondary">180+ 种常见食物,热量按常见份量估算,一键加入本餐。</Text>
        <Text className="lib-tool-link" onClick={() => Taro.navigateTo({ url: '/pages/food-tools/index' })}>小工具:食物对比 · 估重参考 · 红黑榜 ›</Text>
        <Input className="lib-search" placeholder="搜索食物名称,如:鸡胸肉" value={libKw} onInput={(e) => setLibKw(e.detail.value)} />
        <View className="lib-chips">
          {FOOD_CATEGORIES.map((c) => <Text key={c} className={`lib-chip${libCat === c ? ' active' : ''}`} onClick={() => setLibCat(c)}>{c}</Text>)}
        </View>
        {libFiltered.length === 0 && <Text className="fs-mini text-secondary">没有找到相关食物,换个关键词试试。</Text>}
        {libFiltered.slice(0, 60).map((f) => (
          <View className="edit-item" key={`${f.category}-${f.name}`}>
            <View className="col flex-1">
              <Text className="fs-caption">{f.name} · 约 {f.calories} kcal</Text>
              <Text className="fs-mini text-secondary">{f.amount} · 蛋白 {f.proteinG}g / 碳水 {f.carbG}g / 脂肪 {f.fatG}g</Text>
            </View>
            <Button size="mini" onClick={() => addFromLibrary(f)}>加入</Button>
          </View>
        ))}
        {libFiltered.length > 60 && <Text className="lib-more fs-mini text-secondary">共 {libFiltered.length} 条,仅显示前 60 条,输入名称可精确搜索</Text>}
      </View>}

      {mode === 'manual' && <View className="card">
        <Text className="fs-h1">手动录入食物</Text>
        <View className="manual-row">
          <Input className="edit-name" placeholder="食物名" value={manualName} onInput={e => setManualName(e.detail.value)} />
          <Input className="edit-kcal" type="digit" placeholder="热量" value={manualKcal} onInput={e => setManualKcal(e.detail.value)} />
          <Button size="mini" onClick={addManual}>加入本餐</Button>
        </View>
      </View>}
      {mode === 'frequent' && <View className="card">
        <Text className="fs-h1">常用食物</Text>
        <Text className="fs-mini text-secondary">根据你近 30 天的记录自动沉淀，一键加入本餐。</Text>
        {frequent === null && <Text className="fs-mini text-secondary">正在加载…</Text>}
        {frequent !== null && frequent.length === 0 && <>
          <Text className="fs-mini text-secondary">还没有常用食物,多记录几天就会出现在这里。</Text>
          {logs.length > 0 && <Text className="fs-h2" style={{ display: 'block', marginTop: 10 }}>今日吃过</Text>}
        </>}
        {(frequent ?? []).map((f) => <View className="edit-item" key={f.name}>
          <View className="col flex-1">
            <Text className="fs-caption">{f.name} · 约 {f.calories} kcal</Text>
            <Text className="fs-mini text-secondary">{f.amount || '1 份'} · 近 30 天 {f.count} 次</Text>
          </View>
          <Button size="mini" onClick={() => {
            setSource('manual');
            setResultConf(null);
            setItems(prev => [...prev, { name: f.name, amount: f.amount || '1 份', calories: f.calories, proteinG: f.proteinG, carbG: f.carbG, fatG: f.fatG }]);
            setState('need_confirm');
          }}>加入本餐</Button>
        </View>)}
        {frequent !== null && frequent.length === 0 && Array.from(new Map(logs.flatMap(log => log.items).map(item => [item.name, item])).values()).map(item => <View className="edit-item" key={item.name}>
          <Text className="fs-caption">{item.name} · {item.calories} kcal</Text>
          <Button size="mini" onClick={() => { setSource('manual'); setResultConf(null); setItems(prev => [...prev, {...item}]); setState('need_confirm'); }}>加入本餐</Button>
        </View>)}
      </View>}

      {state === 'parsing' && (
        <View className="card ai-card">
          <Text className="fs-caption text-info">正在识别…</Text>
        </View>
      )}

      {state === 'need_confirm' && (
        <View className="card">
          <View className="between">
            <Text className="fs-h1">{editId ? '正在编辑记录' : '本餐待保存'}</Text>
            <Text className="fs-mini text-brand">合计 {Math.round(totalKcal)} kcal</Text>
          </View>
          {!editId && source !== 'manual' && resultConf != null && <Text className="fs-mini text-secondary">
            置信度 {Math.round(resultConf * 100)}%{resultConf < 0.8 ? ' · 部分为估算,建议核对份量' : ' · 热量来自食物库'}
          </Text>}
          {errorMsg && <Text className="fs-caption text-danger">保存失败：{errorMsg}</Text>}
          {items.map((it, i) => (
            <View key={i} className="edit-item">
              <Input
                className="edit-name"
                value={it.name}
                onInput={(e) => updateItem(i, { name: e.detail.value })}
              />
              <View className="row" style={{ gap: 8, alignItems: 'center' }}>
                <Input
                  className="edit-kcal"
                  type="number"
                  value={String(it.calories)}
                  onInput={(e) => updateItem(i, { calories: Number(e.detail.value) || 0 })}
                />
                <Text className="fs-mini text-secondary">kcal</Text>
                <Text className="edit-del" onClick={() => removeItem(i)}>✕</Text>
              </View>
            </View>
          ))}
          {!manualOpen ? (
            <Text className="add-manual" onClick={() => setManualOpen(true)}>+ 手动添加一条</Text>
          ) : (
            <View className="manual-row">
              <Input className="edit-name" placeholder="食物名" value={manualName} onInput={(e) => setManualName(e.detail.value)} />
              <Input className="edit-kcal" type="number" placeholder="热量" value={manualKcal} onInput={(e) => setManualKcal(e.detail.value)} />
              <Button size="mini" className="btn btn--primary" onClick={addManual}>加</Button>
            </View>
          )}
          {editId && <Text className="add-manual" onClick={cancelEdit}>取消编辑</Text>}
          <Button className="btn btn--primary btn--block mt-3" loading={saving} onClick={save}>
            {editId ? '保存修改' : `保存到${MEALS.find((m) => m.key === meal)?.label}`}
          </Button>
        </View>
      )}

      {state === 'failed' && (
        <View className="card">
          <Text className="fs-h2 text-danger">识别失败</Text>
          <Text className="fs-caption">{errorMsg}。未影响数据,请重试或换一种描述。</Text>
        </View>
      )}

      {/* 当日记录:按餐次分组 */}
      <View className="card">
        <Text className="fs-h1">今日记录</Text>
        {logsLoading && logs.length === 0 && <Text className="fs-mini text-secondary">正在加载…</Text>}
        {logsError && <Text className="fs-mini text-secondary" onClick={() => { setLogsError(''); void loadLogs(); }}>今日记录加载失败，点击重试</Text>}
        {!logsLoading && !logsError && logs.length === 0 && <Text className="fs-mini text-secondary">还没有记录</Text>}
        {MEALS.map((m) => {
          const group = logs.filter((l) => l.meal === m.key);
          if (group.length === 0) return null;
          const subtotal = group.reduce((s, l) => s + l.totalCalories, 0);
          return (
            <View key={m.key} className="meal-group">
              <View className="between">
                <Text className="fs-caption text-secondary">{m.label}</Text>
                <Text className="fs-mini text-secondary">{Math.round(subtotal)} kcal</Text>
              </View>
              {group.map((log) => (
                <View key={log.id} className="log-item">
                  <View className="col flex-1">
                    <Text className="fs-caption">
                      {(log.items as { name: string }[]).map((i) => i.name).join('、')}
                    </Text>
                    <Text className="fs-mini text-secondary">{Math.round(log.totalCalories)} kcal</Text>
                  </View>
                  <Text className="fs-mini text-brand" onClick={() => onEditLog(log)}>编辑</Text>
                  <Text className="edit-del" onClick={() => onDeleteLog(log.id)}>删除</Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

