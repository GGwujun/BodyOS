import { useMemo, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Screen from '@/components/Screen';
import { FOOD_LIBRARY } from '@/data/foods';
import type { FoodEntry } from '@/data/foods';
import './index.scss';

/**
 * 食物小工具 — 对比 / 估重参考 / 红黑榜(纯静态工具)
 */
export default function FoodTools() {
  const [tab, setTab] = useState<'compare' | 'estimate' | 'list'>('compare');

  return <Screen className="ft-page">
    <View className="seg">
      {([{ key: 'compare', label: '食物对比' }, { key: 'estimate', label: '估重参考' }, { key: 'list', label: '红黑榜' }] as const).map((t) => (
        <Text key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</Text>
      ))}
    </View>

    {tab === 'compare' && <Compare />}
    {tab === 'estimate' && <Estimate />}
    {tab === 'list' && <GreenRedList />}
  </Screen>;
}

/* ============ 食物对比 ============ */
function Compare() {
  const [left, setLeft] = useState<FoodEntry | null>(null);
  const [right, setRight] = useState<FoodEntry | null>(null);

  return <View className="card">
    <Text className="fs-h1">食物对比</Text>
    <Text className="fs-mini text-secondary">各选一种食物,按常见份量对比热量与营养。</Text>
    <View className="cmp-pickers">
      <FoodPicker label="食物 A" picked={left} onPick={setLeft} />
      <Text className="cmp-vs">VS</Text>
      <FoodPicker label="食物 B" picked={right} onPick={setRight} />
    </View>
    {left && right && (
      <View className="cmp-result">
        <View className="cmp-head">
          <Text className="cmp-name">{left.name}</Text>
          <Text className="cmp-name">{right.name}</Text>
        </View>
        <CmpRow label="份量" a={left.amount} b={right.amount} plain />
        <CmpRow label="热量" a={`${left.calories} kcal`} b={`${right.calories} kcal`} winA={left.calories < right.calories} winB={right.calories < left.calories} winnerNote="更低" />
        <CmpRow label="蛋白质" a={`${left.proteinG}g`} b={`${right.proteinG}g`} winA={left.proteinG > right.proteinG} winB={right.proteinG > left.proteinG} winnerNote="更高" />
        <CmpRow label="碳水" a={`${left.carbG}g`} b={`${right.carbG}g`} winA={left.carbG < right.carbG} winB={right.carbG < left.carbG} winnerNote="更低" />
        <CmpRow label="脂肪" a={`${left.fatG}g`} b={`${right.fatG}g`} winA={left.fatG < right.fatG} winB={right.fatG < left.fatG} winnerNote="更低" />
        <Text className="cmp-note">
          {left.calories === right.calories ? '两者热量接近,按口味和搭配选即可。'
            : `${left.calories < right.calories ? left.name : right.name} 热量更低;${left.proteinG > right.proteinG ? left.name : right.name} 蛋白更高。控体重优先低热量高蛋白的一侧。`}
        </Text>
      </View>
    )}
  </View>;
}

function FoodPicker({ label, picked, onPick }: { label: string; picked: FoodEntry | null; onPick: (f: FoodEntry | null) => void }) {
  const [kw, setKw] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => {
    const k = kw.trim();
    if (!k) return [];
    return FOOD_LIBRARY.filter((f) => f.name.includes(k)).slice(0, 6);
  }, [kw]);
  return <View className="picker-box">
    <Text className="picker-label">{label}</Text>
    {picked
      ? <View className="picker-chosen" onClick={() => { onPick(null); setOpen(true); setKw(''); }}>{picked.name} · 点击重选</View>
      : <Input className="picker-input" placeholder="搜索食物" value={kw}
          onInput={(e) => { setKw(e.detail.value); setOpen(true); }}
          onFocus={() => setOpen(true)} />}
    {open && hits.length > 0 && (
      <View className="picker-hits">
        {hits.map((f) => <Text key={f.name} className="picker-hit"
          onClick={() => { onPick(f); setOpen(false); setKw(''); }}>{f.name} · {f.calories} kcal</Text>)}
      </View>
    )}
  </View>;
}

function CmpRow({ label, a, b, plain, winA, winB, winnerNote }: {
  label: string; a: string; b: string; plain?: boolean; winA?: boolean; winB?: boolean; winnerNote?: string;
}) {
  return <View className={`cmp-row${plain ? ' cmp-row--plain' : ''}`}>
    <Text className="cmp-cell">{a}{winA && <Text className="cmp-win">{winnerNote}</Text>}</Text>
    <Text className="cmp-label">{label}</Text>
    <Text className="cmp-cell">{b}{winB && <Text className="cmp-win">{winnerNote}</Text>}</Text>
  </View>;
}

/* ============ 估重参考 ============ */
const HAND_REFS = [
  { icon: '✊', name: '一拳', desc: '≈ 150g 熟米饭(约一碗)/ 1 个中等水果', tip: '主食一顿一到两拳' },
  { icon: '🖐', name: '一掌心(手掌大小)', desc: '≈ 100g 生肉 / 鱼 / 豆腐', tip: '厚度像一副扑克牌' },
  { icon: '🤲', name: '双手一捧', desc: '≈ 100 ~ 150g 蔬菜', tip: '熟后约半碗,每餐至少一捧' },
  { icon: '👍', name: '一个大拇指', desc: '≈ 10g 油 / 黄油 / 花生酱', tip: '一天烹调油 2.5 个拇指内' },
  { icon: '🥄', name: '一瓷勺(平勺)', desc: '≈ 5g 盐 / 糖 / 酱料', tip: '一天盐不超一啤酒瓶盖(5~6g)' },
  { icon: '🎾', name: '一个网球', desc: '≈ 200g 水果 / 1 个中等苹果橙子', tip: '水果一天 1~2 个网球量' },
];
const TABLEWARE_REFS = [
  { icon: '🍚', name: '标准碗(直径 11cm)', desc: '≈ 150g 熟米饭 / 300ml 汤' },
  { icon: '🥛', name: '标准杯(240ml)', desc: '≈ 250g 牛奶 / 250ml 无糖豆浆' },
  { icon: '🥢', name: '一筷子夹起', desc: '≈ 25 ~ 30g 熟面条或蔬菜' },
  { icon: '🍶', name: '一瓶盖', desc: '≈ 5ml 油 / 酱油,约一茶匙' },
];

function Estimate() {
  return <View className="card">
    <Text className="fs-h1">食物估重参考</Text>
    <Text className="fs-mini text-secondary">没有厨房秤时,用手掌和常见餐具就能估出大概份量,误差通常在两成以内。</Text>
    <Text className="est-sec fs-h2 mt-3">用手估</Text>
    {HAND_REFS.map((r) => <RefRow key={r.name} {...r} />)}
    <Text className="est-sec fs-h2 mt-3">用餐具估</Text>
    {TABLEWARE_REFS.map((r) => <RefRow key={r.name} icon={r.icon} name={r.name} desc={r.desc} />)}
  </View>;
}

function RefRow({ icon, name, desc, tip }: { icon: string; name: string; desc: string; tip?: string }) {
  return <View className="ref-row">
    <Text className="ref-icon">{icon}</Text>
    <View className="ref-copy">
      <Text className="ref-name">{name}</Text>
      <Text className="ref-desc">{desc}{tip ? ` · ${tip}` : ''}</Text>
    </View>
  </View>;
}

/* ============ 红黑榜 ============ */
const GREEN_LIST = [
  { name: '深色叶菜(菠菜/油菜/西兰花)', note: '热量低、纤维和钾丰富,每餐一半' },
  { name: '鱼虾贝类', note: '优质蛋白 + 好脂肪,每周 2~3 次' },
  { name: '鸡胸肉 / 去皮禽肉', note: '高蛋白低脂,减脂期主力' },
  { name: '鸡蛋', note: '全营养食材,每天 1~2 个没问题' },
  { name: '豆腐 / 无糖豆浆', note: '植物蛋白,替代部分红肉' },
  { name: '无糖酸奶 / 牛奶', note: '补钙,选无蔗糖配料表' },
  { name: '燕麦 / 杂粮 / 薯类', note: '低升糖主食,替代一半白米面' },
  { name: '原味坚果', note: '好脂肪,但每天一小把(约15g)就够' },
  { name: '新鲜水果', note: '每天 200~350g,整吃优于榨汁' },
];
const RED_LIST = [
  { name: '含糖饮料 / 奶茶(全糖)', note: '一罐可乐≈35g 糖,热量炸弹第一名' },
  { name: '油炸食品(炸鸡/薯条/油条)', note: '脂肪高且高温产生有害物,每周≤1次' },
  { name: '加工肉(香肠/培根/午餐肉)', note: '高钠高饱和脂肪,能不吃就不吃' },
  { name: '奶油蛋糕 / 甜点', note: '糖+反式脂肪双高,生日再吃' },
  { name: '方便面 + 火腿肠组合', note: '钠超一天上限,加蛋加菜也救不回' },
  { name: '辣条 / 深加工零食', note: '高油高盐高糖三连' },
  { name: '酒精', note: '每克 7 千卡且伤肝,没有"适量有益"' },
];

function GreenRedList() {
  return <View className="card">
    <Text className="fs-h1">食物红黑榜</Text>
    <Text className="fs-mini text-secondary">日常点单/买菜照着挑:绿灯放心吃,红灯尽量少碰。</Text>
    <View className="gr-sec gr-sec--green">
      <Text className="gr-title">🟢 绿灯 · 推荐常吃</Text>
      {GREEN_LIST.map((it) => <View className="gr-row" key={it.name}>
        <Text className="gr-name">{it.name}</Text>
        <Text className="gr-note">{it.note}</Text>
      </View>)}
    </View>
    <View className="gr-sec gr-sec--red">
      <Text className="gr-title">🔴 红灯 · 尽量少碰</Text>
      {RED_LIST.map((it) => <View className="gr-row" key={it.name}>
        <Text className="gr-name">{it.name}</Text>
        <Text className="gr-note">{it.note}</Text>
      </View>)}
    </View>
  </View>;
}
