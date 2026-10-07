import { useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { FOOD_LIBRARY } from '@/data/foods';
import './index.scss';

/**
 * 食物排行 + 查奶茶 — 排行基于内置食物库(常见份量),奶茶为门店常见估算
 */
export default function FoodRank() {
  // 支持入口直达指定 tab(如工具箱的「查奶茶热量」)
  const initParam = Taro.getCurrentInstance().router?.params?.tab;
  const initTab = initParam === 'tea' || initParam === 'low' || initParam === 'protein' ? initParam : 'high';
  const [tab, setTab] = useState<'high' | 'low' | 'protein' | 'tea'>(initTab);

  const high = useMemo(() => [...FOOD_LIBRARY].sort((a, b) => b.calories - a.calories).slice(0, 20), []);
  const low = useMemo(() => [...FOOD_LIBRARY].filter((f) => f.category !== '饮品').sort((a, b) => a.calories - b.calories).slice(0, 20), []);
  const protein = useMemo(() => [...FOOD_LIBRARY].sort((a, b) => b.proteinG - a.proteinG).slice(0, 20), []);

  return <Screen className="rank-page">
    <View className="chips">
      {([{ key: 'high', label: '高热量榜' }, { key: 'low', label: '低热量榜' }, { key: 'protein', label: '高蛋白榜' }, { key: 'tea', label: '查奶茶' }] as const).map((t) => (
        <Text key={t.key} className={`chip${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</Text>
      ))}
    </View>

    {tab !== 'tea' && <Text className="rank-hint fs-mini">按常见份量估算;记录时可在「饮食记录 → 食物库」中一键加入。</Text>}

    {tab === 'high' && <View className="card"><Text className="fs-h1">高热量 Top 20 · 浅尝辄止</Text>{high.map((f, i) => <RankRow key={f.name} rank={i + 1} name={f.name} desc={`${f.amount} · 蛋白 ${f.proteinG}g`} value={`${f.calories} kcal`} tone="red" bar={Math.min(100, f.calories / 6.5)} />)}</View>}
    {tab === 'low' && <View className="card"><Text className="fs-h1">低热量 Top 20 · 放心吃</Text>{low.map((f, i) => <RankRow key={f.name} rank={i + 1} name={f.name} desc={`${f.amount} · 蛋白 ${f.proteinG}g`} value={`${f.calories} kcal`} tone="green" bar={Math.min(100, f.calories / 2)} />)}</View>}
    {tab === 'protein' && <View className="card"><Text className="fs-h1">高蛋白 Top 20 · 长肌肉优选</Text>{protein.map((f, i) => <RankRow key={f.name} rank={i + 1} name={f.name} desc={`${f.amount} · ${f.calories} kcal`} value={`蛋白 ${f.proteinG}g`} tone="blue" bar={Math.min(100, f.proteinG * 3)} />)}</View>}

    {tab === 'tea' && <View className="card">
      <Text className="fs-h1">常见奶茶饮品热量(中杯约 500ml)</Text>
      <Text className="fs-mini text-secondary">数值为门店常见配方估算,选小杯、去掉奶盖奶油能再省 80~150 千卡。</Text>
      <View className="tea-legend">
        <Text className="tea-legend-item">标准糖</Text><Text className="tea-legend-item">七分糖</Text><Text className="tea-legend-item">三分糖</Text><Text className="tea-legend-item">无糖</Text>
      </View>
      {TEA_LIST.map((t) => (
        <View className="tea-row" key={t.name}>
          <View className="tea-copy">
            <Text className="tea-name">{t.name}</Text>
            <Text className="tea-note">{t.note}</Text>
          </View>
          <View className="tea-levels">
            <Text className="tea-lv lv-0">{Math.round(t.base)}</Text>
            <Text className="tea-lv lv-1">{Math.round(t.base * 0.87)}</Text>
            <Text className="tea-lv lv-2">{Math.round(t.base * 0.73)}</Text>
            <Text className="tea-lv lv-3">{Math.round(t.base * 0.58)}</Text>
          </View>
        </View>
      ))}
      <Text className="tea-foot fs-mini">无糖也会因珍珠、奶基底残留部分糖分;一杯全糖奶茶 ≈ 两碗米饭的热量。</Text>
    </View>}
  </Screen>;
}

function RankRow({ rank, name, desc, value, tone, bar }: { rank: number; name: string; desc: string; value: string; tone: 'red' | 'green' | 'blue'; bar: number }) {
  return <View className="rank-row">
    <Text className={`rank-no rank-no--${tone}`}>{rank}</Text>
    <View className="rank-copy">
      <Text className="rank-name">{name}</Text>
      <View className="rank-bar"><View className={`rank-fill rank-fill--${tone}`} style={{ width: `${Math.max(4, Math.round(bar))}%` }} /></View>
      <Text className="rank-desc">{desc}</Text>
    </View>
    <Text className="rank-value">{value}</Text>
  </View>;
}

/** 中杯(约500ml)标准糖热量估算,糖度按 七分/三分/无糖 折算展示 */
const TEA_LIST = [
  { name: '珍珠奶茶', base: 450, note: '珍珠本身含糖,无糖也有热量' },
  { name: '黑糖珍珠鲜奶', base: 520, note: '黑糖浆挂壁,糖量最高的那一档' },
  { name: '芋泥波波奶茶', base: 470, note: '芋泥多含糖油,热量不低' },
  { name: '抹茶拿铁', base: 420, note: '抹茶粉本身低卡,甜度来自糖浆' },
  { name: '奥利奥奶昔', base: 560, note: '饼干碎+奶油顶,甜品级别' },
  { name: '芝士茉莉茶', base: 420, note: '奶盖贡献约一半热量' },
  { name: '椰果奶茶', base: 400, note: '椰果热量低于珍珠' },
  { name: '红豆奶茶', base: 400, note: '红豆罐头通常加糖煮制' },
  { name: '四季春奶茶', base: 380, note: '茶底清爽,选无糖可到 220 左右' },
  { name: '茉莉奶绿', base: 390, note: '绿茶底,腻感更低' },
  { name: '芒果杨枝甘露', base: 400, note: '果肉+西米+淡奶' },
  { name: '草莓优格多', base: 380, note: '酸奶底,蛋白略高' },
  { name: '柠檬茶(标准糖)', base: 260, note: '茶+糖,去糖只剩个位数热量' },
  { name: '茉莉绿茶(标准糖)', base: 230, note: '最轻的一档,无糖近乎零卡' },
  { name: '鲜奶茶(纯牛奶)', base: 320, note: '无植脂末,更推荐' },
];
