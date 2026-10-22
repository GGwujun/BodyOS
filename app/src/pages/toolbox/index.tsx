import { View, Text, Image } from '@tarojs/components';
import Screen from '@/components/Screen';
import { QA_BANK } from '@/data/qa';
import { FOOD_LIBRARY } from '@/data/foods';
import { ASSESSMENTS } from '@/data/assessments';
import foodIcon from '@/assets/icons/food.png';
import scaleIcon from '@/assets/icons/scale.png';
import statsIcon from '@/assets/icons/stats.png';
import cameraIcon from '@/assets/icons/camera.png';
import rulerIcon from '@/assets/icons/ruler.png';
import planIcon from '@/assets/icons/plan.png';
import recipeIcon from '@/assets/icons/recipe.png';
import checkIcon from '@/assets/icons/check.png';
import compassIcon from '@/assets/icons/compass.png';
import './index.scss';
import { navigate } from '@/utils/nav';

interface ToolItem {
  name: string;
  desc: string;
  icon: string;
  url: string;
}

/**
 * 工具箱 —— **找不到家的东西才放这儿**,不是「所有东西的索引」。
 *
 * 一格 = 一个页面。以前不是这样的:「估重参考」「红黑榜」其实是同一页的另外两个分栏,
 * 「徒手/哑铃/杠铃/壶铃/拉伸动作」五个格子全是**同一个动作库**换个筛选参数 ——
 * 三十几格里有一小半点进去是同一页。那不是功能多,那是把一份功能摆成好几份卖:
 * 用户以为有五套动作内容,点开两回就发现"怎么又是这个页面"。
 * 想筛器械/部位,动作库页面上本来就有那一排 chips。
 *
 * 判断一格该不该留,只问一句:**点进去是不是一个别处到不了的地方。**
 * 到得了的(训练计划、动作库、体重数据……)留;只是换个筛选的(那几个壳)不留。
 *
 * 第二个规矩(后加的):**主功能的子页不在这儿。** 训练那十几页原先全在这一页里,
 * 和「每日一答」平级 —— 但它们是训练自己的页面,该从训练的地盘进(计划页页脚),
 * 不该让练完想看结果的人绕到「我的」里来翻杂物间。这一页只放**不属于任何一个流程**的小工具。
 */
const SECTIONS: { title: string; items: ToolItem[] }[] = [
  {
    title: '食物工具',
    items: [
      { name: '食物库', desc: `${FOOD_LIBRARY.length} 种食物热量`, icon: foodIcon, url: '/pages/food/index' },
      { name: '食物对比', desc: '对比 · 估重 · 红黑榜', icon: scaleIcon, url: '/pages/food-tools/index' },
      { name: '食物排行', desc: '高糖高脂 · 奶茶换算', icon: statsIcon, url: '/pages/food-rank/index' },
      { name: '配料识别', desc: '拍配料表看懂成分', icon: cameraIcon, url: '/pages/ingredient/index' }
    ]
  },
  {
    /* 这里**没有**体重数据、围度、进度照片:它们是数据页,不是一个「工具」——
       记的在「记录」,看的在「趋势」,两边都已经有门了(见 docs/04 第三节第 2 条)。
       留下来的这几格是算的、查的、测的,放哪儿都不像有家。 */
    title: '身体与计划',
    items: [
      { name: '身体指标', desc: 'BMI 与体脂率估算', icon: rulerIcon, url: '/pages/tools/index' },
      { name: '体重管理方案', desc: '方案 · 代谢 · 食谱', icon: planIcon, url: '/pages/plan/index' },
      { name: '推荐食谱', desc: '三餐照着吃', icon: recipeIcon, url: '/pages/recipes/index' },
      { name: '健康测评', desc: `${ASSESSMENTS.length} 套健康测评`, icon: checkIcon, url: '/pages/assessment/index' }
    ]
  },
  {
    title: '学点知识',
    items: [
      { name: '每日一答', desc: `${QA_BANK.length} 问减脂百科`, icon: compassIcon, url: '/pages/qa/index' }
    ]
  }
];

/** 健康工具箱 — 全部小工具的统一入口(宫格) */
export default function Toolbox() {
  const go = (url: string) => navigate(url);

  return (
    <Screen className="toolbox-page">
      <View className="toolbox-header">
        <Text className="toolbox-title">健康工具箱</Text>
        <Text className="toolbox-subtitle">算一算、查一查、测一测。</Text>
      </View>
      {SECTIONS.map((sec) => (
        <View className="card" key={sec.title}>
          <Text className="tb-section-title">{sec.title}</Text>
          <View className="tb-grid">
            {sec.items.map((it) => (
              <View className="tb-item" key={it.name} onClick={() => go(it.url)}>
                <View className="tb-icon"><Image className="tb-icon__img" src={it.icon} mode="aspectFit" /></View>
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
