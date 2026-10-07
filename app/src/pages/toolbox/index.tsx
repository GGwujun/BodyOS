import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { QA_BANK } from '@/data/qa';
import './index.scss';

interface ToolItem {
  name: string;
  desc: string;
  emoji: string;
  url: string;
}

const SECTIONS: { title: string; items: ToolItem[] }[] = [
  {
    title: '食物工具',
    items: [
      { name: '食物库搜索', desc: '188 种食物热量', emoji: '🥗', url: '/pages/food/index' },
      { name: '食物对比', desc: '两种食物谁更高', emoji: '⚖️', url: '/pages/food-tools/index' },
      { name: '估重参考', desc: '手掌就是秤', emoji: '🖐', url: '/pages/food-tools/index' },
      { name: '红黑榜', desc: '优选与慎选清单', emoji: '📕', url: '/pages/food-tools/index' },
      { name: '食物排行', desc: '高糖高脂全在榜', emoji: '📊', url: '/pages/food-rank/index' },
      { name: '查奶茶热量', desc: '糖度换算一眼懂', emoji: '🧋', url: '/pages/food-rank/index?tab=tea' },
      { name: '配料识别', desc: '拍配料表看懂成分', emoji: '🧾', url: '/pages/ingredient/index' }
    ]
  },
  {
    title: '身体与计划',
    items: [
      { name: 'BMI 计算器', desc: '体重身高评估', emoji: '📏', url: '/pages/tools/index' },
      { name: '体脂率估算', desc: '看清胖瘦构成', emoji: '💪', url: '/pages/tools/index' },
      { name: '推荐食谱', desc: '三餐照着吃', emoji: '🍱', url: '/pages/recipes/index' },
      { name: '生活方式测评', desc: '5 套专业测评', emoji: '📋', url: '/pages/assessment/index' }
    ]
  },
  {
    title: '学点知识',
    items: [
      { name: '每日一答', desc: `${QA_BANK.length} 问减脂百科`, emoji: '💡', url: '/pages/qa/index' }
    ]
  }
];

/** 健康工具箱 — 全部小工具的统一入口(宫格) */
export default function Toolbox() {
  const go = (url: string) => Taro.navigateTo({ url });

  return (
    <Screen className="toolbox-page">
      {SECTIONS.map((sec) => (
        <View className="card" key={sec.title}>
          <Text className="fs-h1">{sec.title}</Text>
          <View className="tb-grid">
            {sec.items.map((it) => (
              <View className="tb-item" key={it.name} onClick={() => go(it.url)}>
                <View className="tb-icon">{it.emoji}</View>
                <Text className="tb-name">{it.name}</Text>
                <Text className="tb-desc">{it.desc}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
      <Text className="fs-mini text-secondary tb-foot">工具基于公开营养数据与常见公式估算,结果仅供参考。</Text>
    </Screen>
  );
}
