import { useState } from 'react';
import { View, Text, Button, Input } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { Passed, Circle } from '@taroify/icons';
import Screen from '@/components/Screen';
import { userApi } from '@/services';
import { track, trackNow } from '@/services/analytics';
import { toast } from '@/utils/ui';
import './index.scss';

const GOALS = [
  { key: 'fat_loss', title: '减脂', desc: '减少体脂，塑造线条' },
  { key: 'muscle_gain', title: '增肌', desc: '增加肌肉，提升力量' },
  { key: 'maintain', title: '维持', desc: '保持健康，维持现状' },
  { key: 'endurance', title: '提升体能', desc: '增强体能，综合提升' }
] as const;
const DURATIONS = [4, 8, 12, 16];

export default function Onboarding() {
  const [goal, setGoal] = useState<(typeof GOALS)[number]['key']>('fat_loss');
  const [weeks, setWeeks] = useState(8);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  const [target, setTarget] = useState('');
  const unit = goal === 'endurance' ? '分钟/周' : 'kg';
  const targetLabel = goal === 'fat_loss' ? '计划减少的体重' : goal === 'muscle_gain' ? '计划增加的体重' : goal === 'maintain' ? '希望维持的体重' : '每周目标运动时长';
  useDidShow(() => { track('onboarding_start', 'activation'); });
  const submit = async () => {
    if (saving) return;
    const value = Number(target);
    if (!Number.isFinite(value) || value <= 0) { toast('请输入有效的目标数值', 'none'); return; }
    setSaving(true);
    try {
      await userApi.createGoal({ type: goal, targetValue: value, unit, durationWeeks: weeks, isActive: true });
      trackNow('onboarding_complete', 'activation', { goal, weeks, target: value });
      toast('目标已设置'); Taro.switchTab({ url: '/pages/home/index' });
    } catch { toast('保存失败', 'error'); } finally { setSaving(false); }
  };
  return <Screen className="onboarding-page">
    <View className="step-row"><Text>{step} / 3</Text><View><View style={{width:`${step / 3 * 100}%`}} /></View></View>
    {step === 1 && <>
    <View className="onboarding-head"><Text>你的目标是什么？</Text><Text>我们将为你定制专属计划</Text></View>
    <View className="goal-list">{GOALS.map(item => <View key={item.key} className={`goal-option ${goal===item.key?'active':''}`} onClick={() => setGoal(item.key)}><View><Text>{item.title}</Text><Text>{item.desc}</Text></View>{goal===item.key?<Passed/>:<Circle/>}</View>)}</View>
    <Text className="duration-title">预计达成时间</Text>
    <View className="duration-row">{DURATIONS.map(value => <Text key={value} className={weeks===value?'active':''} onClick={() => setWeeks(value)}>{value}周</Text>)}</View>
    </>}
    {step === 2 && <View className="onboarding-head"><Text>设定具体目标</Text><Text>{targetLabel}（{unit}）</Text><Input type="digit" value={target} placeholder="输入你的目标数值" onInput={e=>setTarget(e.detail.value)} /></View>}
    {step === 3 && <View className="onboarding-head"><Text>确认你的计划</Text><Text>{GOALS.find(item=>item.key===goal)?.title} · {weeks}周</Text><Text>{targetLabel}：{target} {unit}</Text><Text>确认后此计划将成为当前目标。</Text></View>}
    {step > 1 && <Button onClick={()=>setStep(step-1)}>上一步</Button>}
    <Button className="next-btn" disabled={saving} loading={saving} onClick={()=>{if(step===3){submit();return;}if(step===2 && (!Number.isFinite(Number(target)) || Number(target)<=0)){toast('请输入有效的目标数值','none');return;}setStep(step+1);}}>{step===3?'确认并保存':'下一步'}</Button>
    <View className="step-dots">{[1,2,3].map(value=><View key={value} className={step===value?'active':''}/>)}</View>
  </Screen>;
}
