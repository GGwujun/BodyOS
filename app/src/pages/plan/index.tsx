import { useEffect, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import WeightSheet from '@/components/WeightSheet';
import { useAsync } from '@/hooks/useAsync';
import { useWeightPlan } from '@/hooks/useWeightPlan';
import { RECIPES } from '@/data/recipes';
import type { Recipe } from '@/data/recipes';
import { track } from '@/services/analytics';
import { userApi } from '@/services';
import { toast } from '@/utils/ui';
import { BMI_NORMAL_RANGE, ageOf, bmiBand, bmiOf, calcBmr, calcTdee } from '@/utils/health';
import './index.scss';

const GOAL_LABELS: Record<string, string> = { fat_loss: '减脂', muscle_gain: '增肌', maintain: '维持', endurance: '提升体能' };

interface MealSlot {
  key: 'breakfast' | 'lunch' | 'dinner';
  label: string;
  share: number;
}
const MEAL_SLOTS: MealSlot[] = [
  { key: 'breakfast', label: '早餐', share: 0.3 },
  { key: 'lunch', label: '午餐', share: 0.4 },
  { key: 'dinner', label: '晚餐', share: 0.3 }
];

/** 按每餐预算从食谱库真实筛选:优先高蛋白,无符合项时给热量最接近的一个(如实标注) */
function pickForSlot(slot: MealSlot, suggestKcal: number): { budget: number; picks: Recipe[]; fallback: boolean } {
  const budget = Math.round(suggestKcal * slot.share);
  const pool = RECIPES.filter((r) => r.mealType === slot.key);
  if (!pool.length) return { budget, picks: [], fallback: false };
  const fit = pool.filter((r) => r.calories <= budget).sort((a, b) => b.proteinG - a.proteinG).slice(0, 2);
  if (fit.length) return { budget, picks: fit, fallback: false };
  const closest = [...pool].sort((a, b) => a.calories - b.calories).slice(0, 1);
  return { budget, picks: closest, fallback: true };
}

/** 体重管理方案 — 方案信息 / 进度时间轴 / 按代谢的真实食谱推荐 */
export default function PlanPage() {
  const { plan, loading, error, refresh } = useWeightPlan();
  const { data: allGoals, refresh: refreshGoals } = useAsync(() => userApi.listGoals(true), []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { track('plan_view', 'other'); }, []);

  const goal = plan?.goal ?? null;
  const profile = plan?.profile;
  const heightCm = profile?.heightCm ?? null;
  const startWeight = plan?.startWeight ?? null;
  const latestWeight = plan?.latestWeight ?? null;
  const isChange = plan?.direction === -1 || plan?.direction === 1;
  const dirLabel = plan?.dirLabel ?? '减重';

  const initialBmi = bmiOf(startWeight, heightCm);
  const initBand = initialBmi != null ? bmiBand(initialBmi) : null;

  const bmr = calcBmr({
    gender: profile?.gender,
    age: ageOf(profile?.birthDate),
    heightCm,
    weightKg: latestWeight
  });
  const tdee = bmr != null ? calcTdee(bmr, profile?.activityLevel) : null;

  // 每日摄入建议:减重按每周目标推缺口(1 公斤脂肪 ≈ 7700 千卡),增肌 +400,维持按总消耗
  let suggestKcal: number | null = null;
  let gapNote = '';
  if (tdee != null) {
    if (plan?.direction === -1) {
      const deficit = plan.weeklyKg != null ? Math.min(1000, Math.round(plan.weeklyKg * 1100)) : 500;
      suggestKcal = Math.max(1200, Math.round(tdee - deficit));
      gapNote = `每日热量缺口约 ${deficit} 千卡`;
    } else if (plan?.direction === 1) {
      suggestKcal = Math.round(tdee + 400);
      gapNote = '增肌期每日热量盈余约 400 千卡';
    } else {
      suggestKcal = Math.round(tdee);
      gapNote = '维持体重按每日总消耗估算';
    }
  }
  const slots = suggestKcal != null ? MEAL_SLOTS.map((s) => pickForSlot(s, suggestKcal as number)) : [];
  const usedKcal = slots.reduce((sum, s) => sum + s.picks.reduce((a, r) => a + r.calories, 0), 0);
  const snack = suggestKcal != null && suggestKcal - usedKcal >= 150
    ? RECIPES.filter((r) => r.mealType === 'snack').sort((a, b) => a.calories - b.calories)[0]
    : undefined;

  const refreshAll = () => { void refresh(); void refreshGoals(); };

  const removePlan = async () => {
    if (!goal || removing) return;
    const { confirm } = await Taro.showModal({
      title: '删除方案',
      content: '删除后当前目标将归档，可随时重新设置；体重记录会全部保留。确定删除吗？'
    });
    if (!confirm) return;
    setRemoving(true);
    try {
      await userApi.archiveGoal(goal.id);
      track('plan_delete', 'other');
      toast('方案已删除');
      refreshAll();
    } catch (e) {
      toast((e as { message?: string })?.message || '删除失败，请重试', 'error');
    } finally {
      setRemoving(false);
    }
  };

  const fmtKg = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toFixed(digits));
  const fmtDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${y}/${m}/${d}`;
  };
  const archived = (allGoals ?? []).filter((g) => g.isActive === false);

  return (
    <Screen className="plan-page">
      {loading && <Text className="status-hint">正在加载…</Text>}
      {error && <Text className="status-hint" onClick={() => refresh()}>加载失败，点击重试</Text>}

      {!loading && !error && (!goal ? (
        <View className="card guide-card">
          <Text className="fs-h1">还没有进行中的方案</Text>
          <Text className="fs-caption guide-copy">设置目标后，这里会展示方案信息、进度时间轴和按你代谢推荐的食谱。</Text>
          <Button className="btn btn--primary btn--block" onClick={() => { track('plan_setup_goal', 'other'); Taro.navigateTo({ url: '/pages/onboarding/index' }); }}>去设置目标</Button>
        </View>
      ) : (
        <>
          {/* 方案信息 */}
          <View className="card info-card">
            <View className="info-head">
              <View className="info-bmi">
                <Text className="info-bmi__text">初始BMI值为：{initialBmi != null ? initialBmi.toFixed(2) : '—'}</Text>
                {initBand && <Text className={`pill tone-${initBand.tone}`}>{initBand.label}</Text>}
              </View>
              <Text className="history-link" onClick={() => { track('plan_history_open', 'other'); setHistoryOpen(true); }}>历史记录</Text>
            </View>
            <Text className="info-note">根据您的身高体重测算，推荐 BMI 正常范围：{BMI_NORMAL_RANGE}（中国成人标准）</Text>

            <View className="info-rows">
              <View className="info-row">
                <Text className="ir-label">目标类型</Text>
                <Text className="ir-value">{GOAL_LABELS[goal.type] ?? goal.type} · {goal.durationWeeks ? `${goal.durationWeeks} 周` : '未设周期'}</Text>
              </View>
              <View className="info-row">
                <Text className="ir-label">身高</Text>
                <Text className="ir-value">{heightCm != null ? `${heightCm}cm` : '未填写'}</Text>
              </View>
              {goal.unit === 'kg' && (
                <View className="info-row">
                  <Text className="ir-label">{isChange ? `${dirLabel}目标` : '目标体重'}</Text>
                  <Text className="ir-value ir-value--green">
                    {isChange ? `${fmtKg(startWeight)} ➜➜ ${fmtKg(plan?.targetWeight)}` : fmtKg(goal.targetValue)} 公斤
                  </Text>
                </View>
              )}
              {goal.type === 'endurance' && (
                <View className="info-row">
                  <Text className="ir-label">运动目标</Text>
                  <Text className="ir-value ir-value--green">每周 {goal.targetValue} 分钟</Text>
                </View>
              )}
              {plan?.weeklyKg != null && (
                <View className="info-row">
                  <Text className="ir-label">每周{dirLabel}</Text>
                  <Text className="ir-value">{plan.weeklyKg.toFixed(2)} 公斤</Text>
                </View>
              )}
              <View className="info-row">
                <Text className="ir-label">基础代谢</Text>
                <Text className="ir-value">
                  {bmr != null ? `${Math.round(bmr)}千卡` : '完善资料后可估算'}
                </Text>
              </View>
            </View>
            {bmr != null
              ? <Text className="info-note">基础代谢按 Mifflin-St Jeor 公式估算，随体重记录更新。</Text>
              : <Text className="info-note">在我的 → 编辑身体信息中补全性别、出生日期、身高后可估算基础代谢。</Text>}

            <View className="plan-ops">
              <Button className="btn btn--secondary op-btn" onClick={() => { track('plan_reset_click', 'other'); Taro.navigateTo({ url: '/pages/onboarding/index' }); }}>重置方案</Button>
              <Button className="btn op-btn op-btn--danger" disabled={removing} onClick={() => void removePlan()}>{removing ? '正在删除…' : '删除方案'}</Button>
            </View>
          </View>

          {/* 体重变化进度 */}
          {goal.unit === 'kg' && (
            <View className="card progress-card">
              <Text className="fs-h1">体重变化进度</Text>
              <View className="timeline">
                <Text className="timeline-date">{plan?.goalStart ? fmtDate(plan.goalStart) : '—'}</Text>
                <View className="timeline-track">
                  <View className="timeline-pill">{plan?.weeklyKg != null ? `每周${dirLabel}${plan.weeklyKg.toFixed(2)}公斤` : '按记录稳步推进'}</View>
                </View>
                <Text className="timeline-date">{plan?.endDate ? fmtDate(plan.endDate) : '进行中'}</Text>
              </View>
              <View className="progress-track">
                <View className="progress-fill" style={{ width: `${plan?.progressPct ?? 0}%` }} />
              </View>
              <View className="progress-cols">
                <View className="p-col">
                  <Text className="p-col__label">初始</Text>
                  <Text className="p-col__value">{fmtKg(startWeight)}<Text className="p-col__unit">公斤</Text></Text>
                </View>
                {isChange ? (
                  <View className="p-col p-col--hit">
                    <Text className="p-col__label p-col__label--green">已{dirLabel}</Text>
                    <Text className="p-col__value p-col__value--green">{fmtKg(plan?.doneKg, 2)}<Text className="p-col__unit">公斤</Text></Text>
                  </View>
                ) : (
                  <View className="p-col">
                    <Text className="p-col__label">当前</Text>
                    <Text className="p-col__value">{fmtKg(latestWeight)}<Text className="p-col__unit">公斤</Text></Text>
                  </View>
                )}
                <View className="p-col">
                  <Text className="p-col__label">目标</Text>
                  <Text className="p-col__value">{fmtKg(plan?.targetWeight)}<Text className="p-col__unit">公斤</Text></Text>
                </View>
              </View>
              {startWeight == null && <Text className="progress-note">目标开始时暂无体重记录，记录一次即可生成初始体重。</Text>}
              <Text className="pending-link" onClick={() => { track('plan_record_open', 'other'); setSheetOpen(true); }}>待记录 »</Text>
            </View>
          )}

          {/* 每日摄入建议 + 食谱推荐(按代谢真实筛选) */}
          <View className="card diet-card">
            <Text className="fs-h1">每日摄入建议</Text>
            {suggestKcal == null ? (
              <Text className="diet-note">在我的 → 编辑身体信息中补全性别、出生日期、身高后，可按基础代谢估算每日摄入并推荐食谱。</Text>
            ) : (
              <>
                <Text className="diet-lead">建议每日摄入约 <Text className="diet-lead__num">{suggestKcal}</Text> 千卡</Text>
                <Text className="diet-note">基础代谢 {Math.round(bmr as number)} 千卡 + 活动消耗估算，{gapNote}；每日摄入不建议低于 1200 千卡。</Text>
                {slots.map((slot, i) => (
                  <View className="meal-block" key={MEAL_SLOTS[i].key}>
                    <View className="meal-head">
                      <Text className="meal-name">{MEAL_SLOTS[i].label}</Text>
                      <Text className="meal-budget">建议 ≤ {slot.budget} 千卡</Text>
                    </View>
                    {slot.picks.length === 0 && <Text className="meal-empty">食谱库中暂无该餐搭配</Text>}
                    {slot.picks.map((r) => (
                      <View className="meal-recipe" key={r.id} onClick={() => { track('plan_recipe_click', 'other', { meal: MEAL_SLOTS[i].key }); Taro.navigateTo({ url: '/pages/recipes/index' }); }}>
                        <View className="mr-main">
                          <Text className="mr-name">{r.name}</Text>
                          <Text className="mr-meta">{r.calories} 千卡 · 蛋白质 {r.proteinG}g{r.tags.length ? ` · ${r.tags[0]}` : ''}</Text>
                        </View>
                        {slot.fallback && <Text className="mr-flag">热量最接近</Text>}
                      </View>
                    ))}
                  </View>
                ))}
                {snack && (
                  <View className="meal-block">
                    <View className="meal-head">
                      <Text className="meal-name">加餐</Text>
                      <Text className="meal-budget">今日还可安排约 {suggestKcal - usedKcal} 千卡</Text>
                    </View>
                    <View className="meal-recipe" onClick={() => Taro.navigateTo({ url: '/pages/recipes/index' })}>
                      <View className="mr-main">
                        <Text className="mr-name">{snack.name}</Text>
                        <Text className="mr-meta">{snack.calories} 千卡 · 蛋白质 {snack.proteinG}g</Text>
                      </View>
                    </View>
                  </View>
                )}
                <Text className="diet-note">食谱由现有食谱库按每餐预算真实筛选（早 3 成 / 午 4 成 / 晚 3 成），营养为整餐估算值。</Text>
                <Button className="btn btn--secondary btn--block" onClick={() => Taro.navigateTo({ url: '/pages/recipes/index' })}>查看全部食谱</Button>
              </>
            )}
          </View>
        </>
      ))}

      {/* 历史方案弹层 */}
      {historyOpen && (
        <View className="pl-mask" onClick={() => setHistoryOpen(false)}>
          <View className="pl-sheet" catchMove onClick={(e) => e.stopPropagation()}>
            <View className="pl-handle" />
            <Text className="pl-title">历史方案</Text>
            {!archived.length && <Text className="pl-empty">暂无历史方案</Text>}
            <View className="pl-list">
              {archived.map((g) => (
                <View className="pl-row" key={g.id}>
                  <View className="pl-row__main">
                    <Text className="pl-row__name">{GOAL_LABELS[g.type] ?? g.type} · {g.durationWeeks ? `${g.durationWeeks} 周` : '未设周期'}</Text>
                    <Text className="pl-row__meta">{g.startDate.slice(0, 10).replace(/-/g, '/')} 开始 · 目标 {g.targetValue} {g.unit}</Text>
                  </View>
                  <Text className="pl-row__state">已结束</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      <WeightSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSaved={() => { track('plan_record_save', 'other'); refreshAll(); }} />
    </Screen>
  );
}
