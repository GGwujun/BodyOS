import { useState, useRef } from 'react';
import { View, Text, Textarea, Button, Input, Picker } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { activityApi, dataSourceApi, userApi } from '@/services';
import { track } from '@/services/analytics';
import { useAsync } from '@/hooks/useAsync';
import { confirmDelete, toast } from '@/utils/ui';
import { todayStr, nowISO } from '@/utils/date';
import { FireOutlined, Edit } from '@taroify/icons';
import {
  cardioOf,
  cardioSubText,
  estimateCalories,
  parseDistanceKm,
  parseIncline,
  paceText
} from '@/utils/cardio';
import type { Activity } from '@/services/types';
import './index.scss';
import { createSubmissionGate } from '@/utils/submissionGate';
import { navigate } from '@/utils/nav';

/** 新增的类型一律**追加**在末尾:编辑时按 `indexOf` 反查,Picker 的 value 也是下标 */
const EX_TYPES = ['跑步', '快走', '骑行', '力量训练', '游泳', '瑜伽', '跳绳', '球类', '徒步', '其他'];

export default function Exercise() {
  const {data,loading,error,refresh:load}=useAsync(()=>activityApi.listActivities(todayStr()),[]);
  /** 估算消耗要用体重;拿不到就按默认体重估,并照实说「按体重估算」 */
  const {data:profile}=useAsync(()=>userApi.getProfile(),[]);
  const activities=data?.items ?? [];
  const [aiText, setAiText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [mode, setMode] = useState<'manual' | 'sync' | 'devices'>('sync');
  // 列表按模式过滤(同步模式显示设备来源,手动模式显示手动/描述来源),统计口径与列表保持一致
  // 「训练」那一档归到手动这边:它不是设备喂进来的,是用户自己练的
  // (力量训练模块练完回写的那条,见 pkg-exercise/engine/workout-energy)。
  // 归错边的后果是它躺在「自动同步」里、身边全是「拉取微信运动步数」——看着像个来路不明的东西
  const shownActivities = mode === 'sync'
    ? activities.filter((a) => !['manual', 'ai_text', 'training'].includes(a.source ?? 'manual'))
    : activities.filter((a) => ['manual', 'ai_text', 'training'].includes(a.source ?? 'manual'));

  // 手动记录表单
  const [showForm, setShowForm] = useState(false);
  /** 「手动记录」tab 仅首次进入自动展开表单,避免从编辑切回时突兀弹层 */
  const manualTabSeen = useRef(false);
  const [typeIdx, setTypeIdx] = useState(0);
  const [duration, setDuration] = useState('');
  const [calories, setCalories] = useState('');
  /** 距离按「公里」收,存的时候转米;坡度按跑步机上的百分数收 */
  const [distance, setDistance] = useState('');
  const [incline, setIncline] = useState('');
  const [savingManual,setSavingManual]=useState(false);
  /** 消耗是这张表单唯一的必填项(见下面的「必填」标记):没填完就别让主按钮看着像能按 */
  const canSaveManual = calories.trim() !== '' && Number.isFinite(Number(calories)) && Number(calories) >= 0;
  const manualSubmission=useRef(createSubmissionGate());
  const [editId, setEditId] = useState<string | null>(null);

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
    track('ai_activity_parse_start', 'ai');
    try {
      const r = await activityApi.parseActivity(aiText);
      if (!r.activities.length) { toast('未识别到运动，请补充描述', 'none'); return; }
      const confirmation = await Taro.showModal({
        title: '确认运动记录',
        content: r.activities.map(a => `${a.type} · ${a.durationMin == null ? '时长未提供' : `${a.durationMin}分钟`}`
          + (cardioSubText(a.type, a.durationMin, a.distanceM, a.inclinePct)
            ? ` · ${cardioSubText(a.type, a.durationMin, a.distanceM, a.inclinePct)}` : '')
          + ` · 估算${a.calories} kcal`).join('\n'),
        confirmText: '确认保存',
        cancelText: '暂不保存'
      });
      if (!confirmation.confirm) return;
      for (const a of r.activities) {
        await activityApi.createActivity({
          type: a.type,
          durationMin: a.durationMin,
          calories: a.calories,
          distanceM: a.distanceM,
          inclinePct: a.inclinePct,
          startedAt: a.startedAt ?? nowISO(),
          source: 'ai_text'
        });
      }
      track('ai_activity_parse_confirm', 'ai', { items: r.activities.length });
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
    const type = EX_TYPES[typeIdx];
    if (!calories.trim() || !Number.isFinite(cal) || cal < 0) {
      toast('请填写非负的消耗热量', 'none');
      return;
    }
    if (dur !== undefined && (!Number.isInteger(dur) || dur <= 0)) {
      toast('运动时长必须为正整数分钟', 'none'); return;
    }
    // 距离/坡度只对「按距离算的运动」有意义,填错了要当场说,不能悄悄丢掉
    const spec = cardioOf(type);
    const distanceM = spec && distance.trim() ? parseDistanceKm(distance) : null;
    if (spec && distance.trim() && distanceM == null) {
      toast('距离请按公里填,比如 5.2', 'none'); return;
    }
    const inclinePct = spec && incline.trim() ? parseIncline(incline) : null;
    if (spec && incline.trim() && inclinePct == null) {
      toast('坡度填 0-40 之间的数,比如 6', 'none'); return;
    }
    setSavingManual(true);
    try {
      if (editId) {
        await activityApi.updateActivity(editId, {
          type,
          durationMin: dur,
          calories: cal,
          // 显式传 null:换成了不问距离的运动时,要把上一次的距离真的清掉
          distanceM: distanceM ?? null,
          inclinePct: inclinePct ?? null
        });
        toast('已更新');
        setEditId(null);
      } else {
        await activityApi.createActivity({
          type,
          durationMin: dur,
          calories: cal,
          distanceM: distanceM ?? undefined,
          inclinePct: inclinePct ?? undefined,
          startedAt: nowISO(),
          source: 'manual'
        });
        toast('已添加');
      }
      setDuration('');
      setCalories('');
      setDistance('');
      setIncline('');
      setShowForm(false);
      await load();
    } catch (e) {
      toast((e as {message?:string})?.message || (editId ? '更新失败，请重试' : '添加失败，请重试'), 'error');
    } finally {
      setSavingManual(false);
    }
  });

  /** 编辑已保存的运动:载入手动表单 */
  const onEditActivity = (a: Activity) => {
    const idx = EX_TYPES.indexOf(a.type);
    setTypeIdx(idx >= 0 ? idx : EX_TYPES.length - 1);
    setDuration(a.durationMin != null ? String(a.durationMin) : '');
    setCalories(String(Math.round(a.calories)));
    // 米 → 公里(留一位小数就够;存的是米,显示不该多出「5.200」这种尾巴)
    setDistance(a.distanceM != null ? String(Math.round(a.distanceM / 100) / 10) : '');
    setIncline(a.inclinePct != null ? String(a.inclinePct) : '');
    setEditId(a.id);
    setMode('manual');
    setShowForm(true);
  };
  const cancelEdit = () => {
    setEditId(null);
    setDuration('');
    setCalories('');
    setDistance('');
    setIncline('');
    setShowForm(false);
  };

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

  // 真同步:拉微信运动加密包推后端,成功后刷新列表
  const [syncing, setSyncing] = useState(false);
  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await dataSourceApi.syncWechatRun();
      toast(r.syncedCount > 0 ? `已同步 ${r.syncedCount} 条新记录` : '运动数据已是最新');
      await load();
    } catch (e) {
      toast((e as {message?:string})?.message || '同步失败，请重试', 'error');
    } finally {
      setSyncing(false);
    }
  };

  // 当前选的这项运动要不要问距离/坡度;问的话算一下配速给个即时反馈
  const spec = cardioOf(EX_TYPES[typeIdx]);
  const typedDistanceM = spec ? parseDistanceKm(distance) : null;
  const durNum = duration ? Number(duration) : null;
  const pace = spec ? paceText(EX_TYPES[typeIdx], durNum, typedDistanceM) : '';
  /** 填了时长但还没填消耗时,给一个按体重的估算 —— 点一下就填上,不擅自替用户决定 */
  const guessCal = !calories.trim() && durNum && durNum > 0
    ? estimateCalories(EX_TYPES[typeIdx], durNum, profile?.weightKg)
    : null;

  return (
    <Screen className="exercise-page">
      <View className="mode-tabs">{([{key:'manual',label:'手动记录'},{key:'sync',label:'自动同步'},{key:'devices',label:'数据来源'}] as const).map(tab => <Text key={tab.key} className={mode === tab.key ? 'active' : ''} onClick={() => { setMode(tab.key); if(tab.key === 'manual' && !manualTabSeen.current) { manualTabSeen.current = true; setShowForm(true); } }}>{tab.label}</Text>)}</View>
      {mode === 'devices' && <View className="card"><Text className="fs-h1">数据来源</Text><Text>查看支持的数据来源及连接状态。</Text><Button className="btn btn--secondary btn--block" onClick={() => navigate('/pages/data-sources/index')}>管理数据来源</Button></View>}
      {mode === 'sync' && <View className="card"><Text className="fs-h1">今日自动同步</Text><Text>拉取微信运动步数，自动生成运动记录。</Text><Button className="btn btn--primary btn--block" loading={syncing} disabled={syncing} onClick={syncNow}>{syncing?'正在同步…':'立即同步'}</Button></View>}

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
          <Text className="fs-h1"><Edit /> {editId ? '编辑运动记录' : '手动记录'}</Text>
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
            {/* 距离和坡度只对按距离算的运动出现 —— 给力量训练问「跑了多远」是没话找话 */}
            {spec && (
              <>
                <View className="form-field">
                  <Text className="fs-mini text-secondary">距离(公里)</Text>
                  <Input
                    className="form-input"
                    type="digit"
                    value={distance}
                    onInput={(e) => setDistance(e.detail.value)}
                    placeholder="选填,比如 5.2"
                  />
                </View>
                {spec.kind === 'pace' && (
                  <View className="form-field">
                    <Text className="fs-mini text-secondary">坡度(%)</Text>
                    <Input
                      className="form-input"
                      type="digit"
                      value={incline}
                      onInput={(e) => setIncline(e.detail.value)}
                      placeholder="跑步机才有,选填"
                    />
                  </View>
                )}
                {pace && <Text className="fs-mini ex-pace">{pace}</Text>}
              </>
            )}
            <View className="form-field">
              <Text className="fs-mini text-secondary">消耗(kcal)<Text className="ex-req">必填</Text></Text>
              <Input
                className="form-input"
                type="number"
                value={calories}
                onInput={(e) => setCalories(e.detail.value)}
              />
            </View>
            {guessCal != null && (
              <Text
                className="fs-mini ex-guess"
                onClick={() => setCalories(String(guessCal))}
              >
                按体重估算约 {guessCal} kcal,点一下填上
              </Text>
            )}
            {editId && <Text className="fs-mini text-secondary" style={{ textDecoration: 'underline', padding: '6px 0', display: 'block' }} onClick={cancelEdit}>取消编辑</Text>}
            <Button className={`btn btn--primary btn--block mt-3${canSaveManual ? '' : ' btn--dim'}`} loading={savingManual} disabled={savingManual} onClick={addManual}>
              {savingManual?'正在保存…':editId?'保存修改':'添加'}
            </Button>
          </View>
        )}
      </View>

      </>}
      {mode !== 'devices' && <>
      {/* 今日运动列表 */}
      <Text className="section-title">运动历史</Text>
      {loading&&<Text>正在加载运动记录…</Text>}
      {error&&<View className="card"><Text>加载失败：{error}</Text><Button className="btn btn--mini btn--secondary" onClick={()=>load()}>重新加载</Button></View>}
      {!loading&&!error&&<View className="card">
        <View className="between">
          <Text className="fs-h1">今日运动</Text>
          <Text className="fs-mini text-secondary">{shownActivities.length} 条</Text>
        </View>
        {shownActivities.length === 0 && <Text className="fs-mini text-secondary">当前分类还没有运动记录</Text>}
        {shownActivities.map((a) => {
          /* 训练模块回写的那条**不给改也不给删**:这条记录是训练日志的派生物,
             真身在训练那边(组数/次数/时长)。在这儿改完,下次练完或改时长会按日志
             重新算一遍把它盖回去;删掉也一样 —— 补写会认出「这条日志还没进账」再建一条。
             折腾一轮回到原样,不如一开始就说清楚它打哪儿来、要改去哪儿改。 */
          const fromTraining = a.source === 'training';
          return (
            <View key={a.id} className="ex-item">
              <View className="col flex-1">
                <Text className="fs-caption">
                  {a.type}
                  {a.durationMin ? ` · ${a.durationMin}分钟` : ''}
                </Text>
                {cardioSubText(a.type, a.durationMin, a.distanceM, a.inclinePct)
                  ? <Text className="fs-mini ex-cardio">{cardioSubText(a.type, a.durationMin, a.distanceM, a.inclinePct)}</Text>
                  : null}
                <Text className="fs-mini text-secondary">来源:{sourceLabel(a.source)}</Text>
                {fromTraining && (
                  <Text className="fs-mini text-secondary">时长取自训练记录,改训练时长这里跟着变</Text>
                )}
              </View>
              <Text className="fs-h2 text-info">{Math.round(a.calories)} kcal</Text>
              {!fromTraining && <Text className="fs-mini text-brand row-act" onClick={() => onEditActivity(a)}>编辑</Text>}
              {!fromTraining && <Text className="ex-del row-act" onClick={() => onDelete(a.id)}>删除</Text>}
            </View>
          );
        })}
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
    huami: '华米',
    // 力量训练模块练完自己写回来的那条(见 pkg-exercise/engine/workout-energy)。
    // 漏了这一项不会报错,只会把原始 key 抖出来 —— 界面上写「来源:training」
    training: '训练'
  };
  return source ? m[source] ?? source : '手动';
}
