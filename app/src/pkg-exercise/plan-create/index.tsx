import { useMemo, useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { navigate } from '@/utils/nav';
import { generatePlan } from '../engine/generator';
import { buildSplit } from '../engine/patterns';
import { loadPlan, savePlan, clearPlan } from '../engine/store';
import { accessFor, kitEmpty, kitSummary, loadKit, type Kit } from '../engine/kit';
import { GOAL_ZH, LEVEL_ZH, ACCESS_ZH, ACCESS_DESC, type EquipAccess, type Goal, type Level } from '../engine/types';
import './index.scss';

const GOALS: Goal[] = ['fatloss', 'muscle', 'endurance'];
const GOAL_DESC: Record<Goal, string> = {
  fatloss: '消耗优先,次数偏高、休息更短', muscle: '肌肥大区间,组数与休息充足', endurance: '高次数耐力,节奏紧凑'
};
const LEVELS: Level[] = ['beginner', 'intermediate'];
const LEVEL_DESC: Record<Level, string> = {
  beginner: '刚练或停练很久,动作求稳', intermediate: '熟悉常见动作,想系统进阶'
};
const ACCESSES: EquipAccess[] = ['body', 'dumbbell', 'home', 'gym'];
const DAY_OPTIONS = [2, 3, 4, 5, 6];
const TIME_OPTIONS = [30, 45, 60];

interface OptProps {
  label: string;
  desc?: string;
  active: boolean;
  onClick: () => void;
}
function Opt({ label, desc, active, onClick }: OptProps) {
  return (
    <View className={`pc-opt${active ? ' active' : ''}`} onClick={onClick}>
      <View className="pc-opt-copy">
        <Text className="pc-opt-label">{label}</Text>
        {desc && <Text className="pc-opt-desc">{desc}</Text>}
      </View>
      <View className={`pc-check${active ? ' checked' : ''}`}>
        {active && <Text className="pc-tick">✓</Text>}
      </View>
    </View>
  );
}

/** 生成我的训练计划 — 四步配置(目标/经验/器械/频率)一次成型 */
export default function PlanCreate() {
  const [goal, setGoal] = useState<Goal>('fatloss');
  const [level, setLevel] = useState<Level>('beginner');
  const [access, setAccess] = useState<EquipAccess>('body');
  const [days, setDays] = useState(3);
  const [sessionMin, setSessionMin] = useState(30);
  const [busy, setBusy] = useState(false);
  /** 我的器材档案 — 登记过就把「器械条件」按它折算,省得在四档预设里猜该选哪个 */
  const [kit] = useState<Kit>(() => loadKit());

  // 分化预览随配置实时变化
  const splitPreview = useMemo(
    () => buildSplit(days, level).map((d) => d.title).join(' · '),
    [days, level]
  );

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const old = loadPlan();
      if (old) {
        const { confirm } = await Taro.showModal({
          title: '重新生成计划',
          content: '会替换现有计划并清空渐进进度(历史记录保留),确定吗?',
          confirmText: '替换',
          cancelText: '取消'
        });
        if (!confirm) { setBusy(false); return; }
        clearPlan();
      }
      const plan = generatePlan({ goal, level, access, daysPerWeek: days, sessionMin });
      savePlan(plan);
      track('training_plan_create', 'other');
      navigate('/pkg-exercise/plan-view/index', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen className="pcreate-page">
      <View className="card pc-intro">
        <Text className="pc-intro-emoji">📋</Text>
        <Text className="fs-h1">定制你的训练计划</Text>
        <Text className="fs-mini text-secondary">
          根据目标、经验与现有器械,从 1300+ 动作库编排属于你的每周安排
        </Text>
      </View>

      <View className="card">
        <Text className="fs-h1 pc-sec-title">1 · 训练目标</Text>
        {GOALS.map((g) => (
          <Opt key={g} label={GOAL_ZH[g]} desc={GOAL_DESC[g]} active={goal === g} onClick={() => setGoal(g)} />
        ))}
      </View>

      <View className="card">
        <Text className="fs-h1 pc-sec-title">2 · 训练经验</Text>
        {LEVELS.map((l) => (
          <Opt key={l} label={LEVEL_ZH[l]} desc={LEVEL_DESC[l]} active={level === l} onClick={() => setLevel(l)} />
        ))}
      </View>

      <View className="card">
        <Text className="fs-h1 pc-sec-title">3 · 器械条件</Text>
        {!kitEmpty(kit) && (
          <View
            className={`pc-kit${access === accessFor(kit) ? ' on' : ''}`}
            onClick={() => setAccess(accessFor(kit))}
          >
            <Text className="pc-kit-t">按我登记的清单:{ACCESS_ZH[accessFor(kit)]}</Text>
            <Text className="fs-mini text-secondary">{kitSummary(kit)}</Text>
          </View>
        )}
        {ACCESSES.map((a) => (
          <Opt key={a} label={ACCESS_ZH[a]} desc={ACCESS_DESC[a]} active={access === a} onClick={() => setAccess(a)} />
        ))}
        {!kitEmpty(kit) && (
          <Text className="fs-mini text-secondary pc-kit-foot">
            选「按我的器材」就是上面这份清单折算出来的条件;清单随时能改,计划要重新生成才会跟着变。
          </Text>
        )}
      </View>

      <View className="card">
        <Text className="fs-h1 pc-sec-title">4 · 每周几天 · 单次多久</Text>
        <View className="pc-chiprow">
          {DAY_OPTIONS.map((d) => (
            <Text key={d} className={`pc-chip${days === d ? ' active' : ''}`} onClick={() => setDays(d)}>{d} 天</Text>
          ))}
        </View>
        <View className="pc-chiprow">
          {TIME_OPTIONS.map((t) => (
            <Text key={t} className={`pc-chip${sessionMin === t ? ' active' : ''}`} onClick={() => setSessionMin(t)}>{t} 分钟</Text>
          ))}
        </View>
        <View className="pc-preview">
          <Text className="fs-mini text-secondary">分化方案:{splitPreview}</Text>
        </View>
      </View>

      <Button className="btn btn--primary btn--block pc-submit" loading={busy} onClick={submit}>生成计划</Button>
      <Text className="fs-mini text-secondary pc-foot">
        计划保存在本机;每次训练完成后会自动调整下次的重量与次数,越练越准。
      </Text>
    </Screen>
  );
}
