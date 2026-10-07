import { useState, useRef } from 'react';
import { View, Text, Textarea, Button, Input, Picker } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { activityApi } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { confirmDelete, toast } from '@/utils/ui';
import { todayStr, nowISO } from '@/utils/date';
import { FireOutlined, Edit } from '@taroify/icons';
import './index.scss';
import { createSubmissionGate } from '@/utils/submissionGate';

const EX_TYPES = ['跑步', '快走', '骑行', '力量训练', '游泳', '瑜伽', '跳绳', '球类', '其他'];

export default function Exercise() {
  const {data,loading,error,refresh:load}=useAsync(()=>activityApi.listActivities(todayStr()),[]);
  const activities=data?.items ?? [];
  const [aiText, setAiText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [mode, setMode] = useState<'manual' | 'sync' | 'devices'>('sync');

  // 手动记录表单
  const [showForm, setShowForm] = useState(false);
  const [typeIdx, setTypeIdx] = useState(0);
  const [duration, setDuration] = useState('');
  const [calories, setCalories] = useState('');
  const [savingManual,setSavingManual]=useState(false);
  const manualSubmission=useRef(createSubmissionGate());

  usePullDownRefresh(async () => {
    await load();
    Taro.stopPullDownRefresh();
  });

  const parse = async () => {
    if (parsing) return;
    if (!aiText.trim()) {
      toast('请输入运动描述', 'none');
      return;
    }
    setParsing(true);
    try {
      const r = await activityApi.parseActivity(aiText);
      if (!r.activities.length) { toast('未识别到运动，请补充描述', 'none'); return; }
      const confirmation = await Taro.showModal({
        title: '确认运动记录',
        content: r.activities.map(a => `${a.type} · ${a.durationMin == null ? '时长未提供' : `${a.durationMin}分钟`} · 估算${a.calories} kcal`).join('\n'),
        confirmText: '确认保存',
        cancelText: '暂不保存'
      });
      if (!confirmation.confirm) return;
      for (const a of r.activities) {
        await activityApi.createActivity({
          type: a.type,
          durationMin: a.durationMin,
          calories: a.calories,
          startedAt: a.startedAt ?? nowISO(),
          source: 'ai_text'
        });
      }
      toast(`已添加 ${r.activities.length} 条`);
      setAiText('');
      await load();
    } catch (e) {
      toast((e as { message?: string })?.message || '解析失败', 'error');
    } finally {
      setParsing(false);
    }
  };

  const addManual = () => manualSubmission.current(async () => {
    const cal = Number(calories);
    const dur = duration ? Number(duration) : undefined;
    if (!calories.trim() || !Number.isFinite(cal) || cal < 0) {
      toast('请填写非负的消耗热量', 'none');
      return;
    }
    if (dur !== undefined && (!Number.isInteger(dur) || dur <= 0)) {
      toast('运动时长必须为正整数分钟', 'none'); return;
    }
    setSavingManual(true);
    try {
      await activityApi.createActivity({
        type: EX_TYPES[typeIdx],
        durationMin: dur,
        calories: cal,
        startedAt: nowISO(),
        source: 'manual'
      });
      toast('已添加');
      setDuration('');
      setCalories('');
      setShowForm(false);
      await load();
    } catch (e) {
      toast((e as {message?:string})?.message || '添加失败，请重试', 'error');
    } finally {
      setSavingManual(false);
    }
  });

  const onDelete = async (id: string) => {
    const ok = await confirmDelete('删除这条运动记录?', '删除后今日消耗将重新计算。');
    if (!ok) return;
    try {
      await activityApi.deleteActivity(id);
      await load();
      toast('已删除');
    } catch {
      toast('删除失败', 'error');
    }
  };

  return (
    <Screen className="exercise-page">
      <View className="mode-tabs">{([{key:'manual',label:'手动记录'},{key:'sync',label:'自动同步'},{key:'devices',label:'智能设备'}] as const).map(tab => <Text key={tab.key} className={mode === tab.key ? 'active' : ''} onClick={() => { setMode(tab.key); if(tab.key === 'manual') setShowForm(true); }}>{tab.label}</Text>)}</View>
      {mode === 'devices' && <View className="card"><Text className="fs-h1">设备与数据连接</Text><Text>查看支持的数据来源及连接状态。</Text><Button onClick={() => Taro.navigateTo({url:'/pages/data-sources/index'})}>管理数据来源</Button></View>}
      {mode === 'sync' && <View className="card"><Text className="fs-h1">今日自动同步</Text><Text>展示设备或数据源导入的运动记录。</Text><Button onClick={load}>刷新同步记录</Button></View>}

      {/* AI 自然语言 */}
      {mode === 'manual' && <><View className="card ai-entry">
        <FireOutlined className="card-accent" />
        <Text className="fs-h1">用一句话描述</Text>
        <Textarea
          className="ex-input"
          placeholder="例如:晨跑 30 分钟,配速 6:00"
          value={aiText}
          onInput={(e) => setAiText(e.detail.value)}
        />
        <Button className="btn btn--primary btn--block mt-3" loading={parsing} onClick={parse}>
          快速记录
        </Button>
      </View>

      {/* 手动记录 */}
      <View className="card manual-card">
        <View className="between" onClick={() => setShowForm((v) => !v)}>
          <Text className="fs-h1"><Edit /> 手动记录</Text>
          <Text className="fs-mini text-secondary">{showForm ? '收起' : '展开'}</Text>
        </View>
        {showForm && (
          <View className="mt-3">
            <Picker mode="selector" range={EX_TYPES} value={typeIdx} onChange={(e) => setTypeIdx(Number(e.detail.value))}>
              <View className="form-field">
                <Text className="fs-mini text-secondary">类型</Text>
                <Text className="fs-caption">{EX_TYPES[typeIdx]}</Text>
              </View>
            </Picker>
            <View className="form-field">
              <Text className="fs-mini text-secondary">时长(分钟)</Text>
              <Input
                className="form-input"
                type="number"
                value={duration}
                onInput={(e) => setDuration(e.detail.value)}
                placeholder="选填"
              />
            </View>
            <View className="form-field">
              <Text className="fs-mini text-secondary">消耗(kcal)</Text>
              <Input
                className="form-input"
                type="number"
                value={calories}
                onInput={(e) => setCalories(e.detail.value)}
              />
            </View>
            <Button className="btn btn--primary btn--block mt-3" loading={savingManual} disabled={savingManual} onClick={addManual}>
              {savingManual?'正在保存…':'添加'}
            </Button>
          </View>
        )}
      </View>

      </>}
      {mode !== 'devices' && <>
      {/* 今日运动列表 */}
      <Text className="section-title">运动历史</Text>
      {loading&&<Text>正在加载运动记录…</Text>}
      {error&&<View className="card"><Text>加载失败：{error}</Text><Button onClick={()=>load()}>重新加载</Button></View>}
      {!loading&&!error&&<View className="card history-card">
        <View className="between">
          <Text className="fs-h1">今日运动</Text>
          <Text className="fs-mini text-secondary">{activities.length} 条</Text>
        </View>
        {activities.filter(a => mode === 'sync' ? !['manual','ai_text'].includes(a.source ?? 'manual') : ['manual','ai_text'].includes(a.source ?? 'manual')).length === 0 && <Text className="fs-mini text-secondary">当前分类还没有运动记录</Text>}
        {activities.filter(a => mode === 'sync' ? !['manual','ai_text'].includes(a.source ?? 'manual') : ['manual','ai_text'].includes(a.source ?? 'manual')).map((a) => (
          <View key={a.id} className="ex-item">
            <View className="col flex-1">
              <Text className="fs-caption">
                {a.type}
                {a.durationMin ? ` · ${a.durationMin}分钟` : ''}
              </Text>
              <Text className="fs-mini text-secondary">来源:{sourceLabel(a.source)}</Text>
            </View>
            <Text className="fs-h2 text-info">{Math.round(a.calories)} kcal</Text>
            <Text className="ex-del" onClick={() => onDelete(a.id)}>删除</Text>
          </View>
        ))}
      </View>}
      </>}
    </Screen>
  );
}

function sourceLabel(source?: string): string {
  const m: Record<string, string> = {
    manual: '手动',
    ai_text: '快捷记录',
    wechat: '微信运动',
    apple_health: 'Apple 健康',
    mi: '小米运动',
    huami: '华米'
  };
  return source ? m[source] ?? source : '手动';
}
