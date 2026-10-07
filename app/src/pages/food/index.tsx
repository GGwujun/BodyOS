import { useState, useCallback, useEffect } from 'react';
import { View, Text, Textarea, Button, Input } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { foodApi } from '@/services';
import { track } from '@/services/analytics';
import type { FoodItem, FoodLog } from '@/services/types';
import { confirmDelete, toast } from '@/utils/ui';
import { todayStr } from '@/utils/date';
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
  const [mode, setMode] = useState<'ai' | 'manual' | 'frequent'>('ai');
  const [source, setSource] = useState<FoodLog['source']>('manual');
  const [text, setText] = useState('');
  const [state, setState] = useState<ParseState>('idle');
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<FoodItem[]>([]);
  const [resultConf, setResultConf] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualKcal, setManualKcal] = useState('');

  const loadLogs = useCallback(async () => {
    try {
      const r = await foodApi.listFoodLogs(today);
      setLogs(r.items);
    } catch (e) {
      void e;
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
        const img = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] });
        const file = img.tempFilePaths[0];
        const base64 = await fileToBase64(file);
        r = await foodApi.parseFood({ image: base64 });
      } else {
        r = await foodApi.parseFood({ text });
      }
      setItems(r.items);
      setSource(useImage ? 'ai_image' : 'ai_text');
      setResultConf(r.confidence ?? 0);
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
    if (saving || items.length === 0) return;
    if (items.some(item => !item.name.trim() || !Number.isFinite(item.calories) || item.calories < 0)) {
      toast('请检查食物名称和热量', 'none'); return;
    }
    setSaving(true);
    try {
      await foodApi.createFoodLog({ meal, items, source });
      track('ai_food_parse_confirm', 'ai', { items: items.length });
      toast('已保存');
      setState('idle');
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
      <View className="mode-tabs">{([{key:'ai',label:'快速识别'},{key:'manual',label:'手动添加'},{key:'frequent',label:'常用食物'}] as const).map(tab => <Text key={tab.key} className={mode === tab.key ? 'active' : ''} onClick={() => setMode(tab.key)}>{tab.label}</Text>)}</View>

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

      {mode === 'manual' && <View className="card">
        <Text className="fs-h1">手动录入食物</Text>
        <View className="manual-row">
          <Input className="edit-name" placeholder="食物名" value={manualName} onInput={e => setManualName(e.detail.value)} />
          <Input className="edit-kcal" type="digit" placeholder="热量" value={manualKcal} onInput={e => setManualKcal(e.detail.value)} />
          <Button size="mini" onClick={addManual}>加入本餐</Button>
        </View>
      </View>}
      {mode === 'frequent' && <View className="card">
        <Text className="fs-h1">从今日记录再次添加</Text>
        {logs.length === 0 && <Text className="fs-mini text-secondary">保存饮食记录后，可在这里再次添加。</Text>}
        {Array.from(new Map(logs.flatMap(log => log.items).map(item => [item.name, item])).values()).map(item => <View className="edit-item" key={item.name}>
          <Text>{item.name} · {item.calories} kcal</Text>
          <Button size="mini" onClick={() => { setItems(prev => [...prev, {...item}]); setState('need_confirm'); }}>加入本餐</Button>
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
            <Text className="fs-h1">本餐待保存</Text>
            <Text className="fs-mini text-brand">合计 {Math.round(totalKcal)} kcal</Text>
          </View>
          {source !== 'manual' && <Text className="fs-mini text-secondary">
            置信度 {Math.round(resultConf * 100)}%{resultConf < 0.8 ? ' · 部分为估算,建议核对份量' : ' · 热量来自食物库'}
          </Text>}
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
          <Button className="btn btn--primary btn--block mt-3" loading={saving} onClick={save}>
            保存到{MEALS.find((m) => m.key === meal)?.label}
          </Button>
        </View>
      )}

      {state === 'failed' && (
        <View className="card">
          <Text className="fs-h2 text-danger">识别失败</Text>
          <Text className="fs-caption">{errorMsg}。未影响数据,请重试或换一种描述。</Text>
        </View>
      )}

      {/* 当日记录 */}
      <View className="card">
        <Text className="fs-h1">今日记录</Text>
        {logs.length === 0 && <Text className="fs-mini text-secondary">还没有记录</Text>}
        {logs.map((log) => (
          <View key={log.id} className="log-item">
            <View className="col flex-1">
              <Text className="fs-caption">
                {mealLabel(log.meal)} · {(log.items as { name: string }[]).map((i) => i.name).join('、')}
              </Text>
              <Text className="fs-mini text-secondary">{Math.round(log.totalCalories)} kcal</Text>
            </View>
            <Text className="edit-del" onClick={() => onDeleteLog(log.id)}>删除</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

function mealLabel(meal: string): string {
  const m: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
  return m[meal] ?? meal;
}

async function fileToBase64(filePath: string): Promise<string> {
  const fs = Taro.getFileSystemManager();
  const base64 = fs.readFileSync(filePath, 'base64');
  return `data:image/jpeg;base64,${base64}`;
}
