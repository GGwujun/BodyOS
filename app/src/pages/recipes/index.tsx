import { useMemo, useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { RECIPES, RECIPE_MEALS } from '@/data/recipes';
import type { Recipe, RecipeMeal } from '@/data/recipes';
import { foodApi } from '@/services';
import { toast } from '@/utils/ui';
import './index.scss';

/**
 * 推荐食谱 — 静态精选食谱,看做法 + 一键记为当餐
 */
export default function Recipes() {
  const [filter, setFilter] = useState<RecipeMeal | 'all'>('all');
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [meal, setMeal] = useState<RecipeMeal>('lunch');
  const [saving, setSaving] = useState(false);

  const list = useMemo(() => (filter === 'all' ? RECIPES : RECIPES.filter((r) => r.mealType === filter)), [filter]);

  const openDetail = (r: Recipe) => {
    setDetail(r);
    setMeal(r.mealType);
  };

  const logRecipe = async () => {
    if (!detail || saving) return;
    setSaving(true);
    try {
      await foodApi.createFoodLog({
        meal,
        items: [{ name: detail.name, amount: '1 份', calories: detail.calories, proteinG: detail.proteinG, carbG: detail.carbG, fatG: detail.fatG }],
        source: 'manual',
      });
      toast(`已记入${mealLabel(meal)}`);
      setDetail(null);
    } catch (e) {
      toast((e as { message?: string })?.message || '记录失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  };

  return <Screen className="recipes-page">
    <Text className="recipes-intro fs-mini">24 套家常搭配,营养为整餐估算。照着吃,或一键记入当餐记录。</Text>
    <View className="meal-chips">
      {RECIPE_MEALS.map((m) => <Text key={m.key} className={`chip${filter === m.key ? ' active' : ''}`} onClick={() => setFilter(m.key)}>{m.label}</Text>)}
    </View>

    <View className="recipe-list">
      {list.map((r) => (
        <View className="recipe-card" key={r.id} onClick={() => openDetail(r)}>
          <View className="recipe-head">
            <Text className="recipe-name">{r.name}</Text>
            <Text className="recipe-kcal">{r.calories} kcal</Text>
          </View>
          <View className="recipe-macros">
            <Text className="macro m-protein">蛋白 {r.proteinG}g</Text>
            <Text className="macro m-carb">碳水 {r.carbG}g</Text>
            <Text className="macro m-fat">脂肪 {r.fatG}g</Text>
          </View>
          <View className="recipe-tags">
            {r.tags.map((t) => <Text key={t} className="recipe-tag">{t}</Text>)}
            <Text className="recipe-tag tag-meal">{mealLabel(r.mealType)}</Text>
          </View>
        </View>
      ))}
    </View>

    {detail && (
      <View className="mask" onClick={() => !saving && setDetail(null)}>
        <View className="detail-sheet" catchMove onClick={(e) => e.stopPropagation()}>
          <View className="sheet-handle" />
          <View className="detail-head">
            <View className="col flex-1">
              <Text className="detail-name">{detail.name}</Text>
              <Text className="fs-mini">{detail.tags.join(' · ')}</Text>
            </View>
            <Text className="detail-kcal">{detail.calories}<Text className="detail-kcal-unit"> kcal</Text></Text>
          </View>

          <View className="nutri-card">
            <Text className="nutri-title">营养估算与供能比(整餐)</Text>
            <View className="nutri-main">
              <Donut protein={detail.proteinG} carb={detail.carbG} fat={detail.fatG} kcal={detail.calories} />
              <View className="nutri-legend">
                <LegendRow label="碳水" color="#d97706" grams={detail.carbG} pct={energyShare(detail.proteinG, detail.carbG, detail.fatG, 'carb')} />
                <LegendRow label="蛋白质" color="#0284c7" grams={detail.proteinG} pct={energyShare(detail.proteinG, detail.carbG, detail.fatG, 'protein')} />
                <LegendRow label="脂肪" color="#e11d48" grams={detail.fatG} pct={energyShare(detail.proteinG, detail.carbG, detail.fatG, 'fat')} />
              </View>
            </View>
          </View>

          <View className="nutri-card">
            <Text className="nutri-title">食材</Text>
            {detail.ingredients.map((s, i) => <Text key={i} className="nutri-line">· {s}</Text>)}
          </View>
          <View className="nutri-card">
            <Text className="nutri-title">做法</Text>
            {detail.steps.map((s, i) => <Text key={i} className="nutri-line">{i + 1}. {s}</Text>)}
          </View>

          <View className="nutri-card qa-card">
            <Text className="nutri-title">营养问答</Text>
            <Text className="qa-q">Q: {detail.qa.q}</Text>
            <Text className="qa-a">{detail.qa.a}</Text>
          </View>

          <Text className="meal-pick-label">记入餐次</Text>
          <View className="meal-pick">
            {([{ key: 'breakfast', label: '早餐' }, { key: 'lunch', label: '午餐' }, { key: 'dinner', label: '晚餐' }, { key: 'snack', label: '加餐' }] as const).map((m) => (
              <Text key={m.key} className={`chip${meal === m.key ? ' active' : ''}`} onClick={() => setMeal(m.key)}>{m.label}</Text>
            ))}
          </View>
          <Button className="log-btn" loading={saving} disabled={saving} onClick={logRecipe}>记为这一餐</Button>
        </View>
      </View>
    )}
  </Screen>;
}

function energyShare(protein: number, carb: number, fat: number, kind: 'protein' | 'carb' | 'fat'): number {
  const p = protein * 4, c = carb * 4, f = fat * 9;
  const total = Math.max(1, p + c + f);
  const v = kind === 'protein' ? p : kind === 'carb' ? c : f;
  return Math.round((v / total) * 100);
}

/** 供能比环形图:碳水/蛋白/脂肪三段,中心为总千卡 */
function Donut({ protein, carb, fat, kcal }: { protein: number; carb: number; fat: number; kcal: number }) {
  const cPct = energyShare(protein, carb, fat, 'carb');
  const proteinEnd = cPct + energyShare(protein, carb, fat, 'protein');
  const bg = `conic-gradient(#d97706 0% ${cPct}%, #0284c7 ${cPct}% ${proteinEnd}%, #e11d48 ${proteinEnd}% 100%)`;
  return <View className="donut" style={{ background: bg }}>
    <View className="donut__inner">
      <Text className="donut__kcal">{kcal}</Text>
      <Text className="donut__unit">千卡</Text>
    </View>
  </View>;
}

function LegendRow({ label, color, grams, pct }: { label: string; color: string; grams: number; pct: number }) {
  return <View className="legend-row">
    <View className="legend-dot" style={{ background: color }} />
    <Text className="legend-label">{label}</Text>
    <Text className="legend-pct">{pct}% · {grams}g</Text>
  </View>;
}

function mealLabel(meal: string): string {
  return ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' } as Record<string, string>)[meal] ?? meal;
}
