/**
 * 精选食谱库 — 常见中式家常搭配,营养为整餐估算值
 * 用途:照着吃 + 一键记为当餐记录
 */

export type RecipeMeal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Recipe {
  id: string;
  name: string;
  mealType: RecipeMeal;
  tags: string[];
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  ingredients: string[];
  steps: string[];
}

export const RECIPE_MEALS: { key: RecipeMeal | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
  { key: 'snack', label: '加餐' },
];

export const RECIPES: Recipe[] = [
  {
    id: 'r01', name: '燕麦牛奶碗', mealType: 'breakfast', tags: ['高纤维', '快手续'],
    calories: 320, proteinG: 14, carbG: 45, fatG: 10,
    ingredients: ['燕麦片 40g', '牛奶 250ml', '蓝莓 一小把', '奇亚籽 3g'],
    steps: ['燕麦片加牛奶小火煮 3 分钟或隔夜冷藏泡软', '撒上蓝莓与奇亚籽即可'],
  },
  {
    id: 'r02', name: '全麦鸡蛋三明治', mealType: 'breakfast', tags: ['高蛋白', '十分钟'],
    calories: 340, proteinG: 17, carbG: 38, fatG: 12,
    ingredients: ['全麦面包 2 片', '鸡蛋 1 个', '生菜 2 片', '番茄 2 片'],
    steps: ['鸡蛋煎熟,面包片稍烤', '夹入生菜、番茄、鸡蛋,对切开'],
  },
  {
    id: 'r03', name: '小米南瓜粥 + 水煮蛋', mealType: 'breakfast', tags: ['养胃', '低脂'],
    calories: 240, proteinG: 10, carbG: 38, fatG: 6,
    ingredients: ['小米 40g', '南瓜 150g', '鸡蛋 1 个'],
    steps: ['小米加水煮开,放入南瓜块小火 20 分钟', '鸡蛋冷水下锅煮 8 分钟'],
  },
  {
    id: 'r04', name: '豆浆 + 青菜香菇包', mealType: 'breakfast', tags: ['植物蛋白'],
    calories: 300, proteinG: 13, carbG: 42, fatG: 8,
    ingredients: ['无糖豆浆 250ml', '青菜香菇包 1 个(约80g)'],
    steps: ['包子蒸 10 分钟', '配一杯温热无糖豆浆'],
  },
  {
    id: 'r05', name: '酸奶水果杯', mealType: 'breakfast', tags: ['免开火', '高钙'],
    calories: 280, proteinG: 12, carbG: 34, fatG: 10,
    ingredients: ['无糖酸奶 150g', '香蕉 半根', '混合坚果碎 8g'],
    steps: ['酸奶倒入碗中', '铺上香蕉片与坚果碎'],
  },
  {
    id: 'r06', name: '玉米 + 茶叶蛋 + 牛奶', mealType: 'breakfast', tags: ['均衡', '便携'],
    calories: 380, proteinG: 18, carbG: 50, fatG: 12,
    ingredients: ['玉米 1 根', '茶叶蛋 1 个', '牛奶 250ml'],
    steps: ['玉米蒸 15 分钟', '配茶叶蛋与牛奶即成'],
  },
  {
    id: 'r07', name: '香煎鸡胸藜麦饭', mealType: 'lunch', tags: ['高蛋白', '减脂'],
    calories: 450, proteinG: 38, carbG: 42, fatG: 12,
    ingredients: ['鸡胸肉 120g', '藜麦饭 150g', '西兰花 100g', '橄榄油 5g'],
    steps: ['鸡胸用黑胡椒盐腌 10 分钟,少油煎至两面金黄', '西兰花焯水 2 分钟', '装盘配藜麦饭'],
  },
  {
    id: 'r08', name: '番茄牛腩糙米饭', mealType: 'lunch', tags: ['饱腹', '补铁'],
    calories: 520, proteinG: 28, carbG: 58, fatG: 18,
    ingredients: ['牛腩 80g', '番茄 1 个', '糙米饭 150g', '洋葱少许'],
    steps: ['牛腩焯水后与番茄洋葱同炖 40 分钟', '浇在糙米饭上'],
  },
  {
    id: 'r09', name: '清蒸鲈鱼套餐', mealType: 'lunch', tags: ['低脂', '优质蛋白'],
    calories: 430, proteinG: 32, carbG: 45, fatG: 10,
    ingredients: ['鲈鱼 1 条(约300g)', '杂粮饭 130g', '姜丝葱丝', '时令绿叶菜 150g'],
    steps: ['鲈鱼铺姜丝大火蒸 8 分钟,淋蒸鱼豉油', '配杂粮饭与焯青菜'],
  },
  {
    id: 'r10', name: '虾仁滑蛋盖饭', mealType: 'lunch', tags: ['嫩滑', '高蛋白'],
    calories: 470, proteinG: 28, carbG: 58, fatG: 12,
    ingredients: ['虾仁 100g', '鸡蛋 1 个', '米饭 150g', '葱花'],
    steps: ['虾仁炒至变色盛出', '蛋液半凝固时回锅虾仁,轻翻几下盖在饭上'],
  },
  {
    id: 'r11', name: '鸡丝荞麦凉面', mealType: 'lunch', tags: ['清爽', '低升糖'],
    calories: 430, proteinG: 26, carbG: 55, fatG: 9,
    ingredients: ['鸡胸肉 80g', '荞麦面(干)70g', '黄瓜丝', '麻酱汁少许'],
    steps: ['鸡胸煮熟撕成丝,荞麦面煮 5 分钟过凉水', '加黄瓜丝与稀释麻酱拌匀'],
  },
  {
    id: 'r12', name: '彩椒牛肉炒饭', mealType: 'lunch', tags: ['快炒', '补铁'],
    calories: 480, proteinG: 26, carbG: 60, fatG: 14,
    ingredients: ['瘦牛肉 80g', '米饭 150g', '红黄彩椒各半个', '橄榄油 5g'],
    steps: ['牛肉切片大火快炒盛出', '彩椒略炒后加米饭与牛肉翻匀'],
  },
  {
    id: 'r13', name: '藜麦蔬菜沙拉 + 煎蛋', mealType: 'lunch', tags: ['轻食', '素食友好'],
    calories: 380, proteinG: 16, carbG: 40, fatG: 16,
    ingredients: ['藜麦(干)40g', '鸡蛋 1 个', '小番茄 6 颗', '油醋汁'],
    steps: ['藜麦煮 12 分钟放凉', '铺蔬菜与煎蛋,淋油醋汁'],
  },
  {
    id: 'r14', name: '冬瓜虾仁汤 + 杂粮饭', mealType: 'dinner', tags: ['清淡', '低卡'],
    calories: 300, proteinG: 20, carbG: 38, fatG: 6,
    ingredients: ['冬瓜 200g', '虾仁 80g', '杂粮饭 100g', '姜丝'],
    steps: ['冬瓜与姜丝煮 10 分钟,下虾仁再煮 3 分钟', '配小碗杂粮饭'],
  },
  {
    id: 'r15', name: '蒸鸡腿 + 时蔬 + 米饭', mealType: 'dinner', tags: ['去皮更低脂'],
    calories: 420, proteinG: 30, carbG: 45, fatG: 10,
    ingredients: ['鸡腿 1 个(去皮)', '米饭 100g', '时令蔬菜 150g'],
    steps: ['鸡腿去皮划刀,蒸 20 分钟', '蔬菜白灼或清炒'],
  },
  {
    id: 'r16', name: '番茄豆腐龙利鱼', mealType: 'dinner', tags: ['高蛋白', '无刺'],
    calories: 350, proteinG: 32, carbG: 18, fatG: 14,
    ingredients: ['龙利鱼 150g', '北豆腐 100g', '番茄 1 个'],
    steps: ['番茄炒出汁加水煮开', '下豆腐与鱼块煮 6 分钟,调味出锅'],
  },
  {
    id: 'r17', name: '上汤娃娃菜 + 玉米 + 鸡蛋', mealType: 'dinner', tags: ['素食友好'],
    calories: 300, proteinG: 12, carbG: 36, fatG: 10,
    ingredients: ['娃娃菜 200g', '玉米 1 根', '鸡蛋 1 个', '皮蛋丁少许'],
    steps: ['清水或高汤煮娃娃菜 5 分钟', '配蒸玉米与水煮蛋'],
  },
  {
    id: 'r18', name: '白灼虾 + 蒜蓉西兰花', mealType: 'dinner', tags: ['低碳水', '高蛋白'],
    calories: 380, proteinG: 28, carbG: 25, fatG: 8,
    ingredients: ['鲜虾 150g', '西兰花 200g', '蒜末', '小碗米饭 50g'],
    steps: ['虾沸水焯 2 分钟蘸姜醋汁', '西兰花焯后轻炒蒜末'],
  },
  {
    id: 'r19', name: '香菇蒸鸡 + 紫薯 + 青菜', mealType: 'dinner', tags: ['粗粮'],
    calories: 400, proteinG: 26, carbG: 42, fatG: 10,
    ingredients: ['鸡腿肉 120g', '鲜香菇 3 朵', '紫薯 120g', '青菜 150g'],
    steps: ['鸡肉与香菇拌匀蒸 18 分钟', '紫薯蒸 20 分钟,青菜白灼'],
  },
  {
    id: 'r20', name: '海带豆腐汤 + 全麦馒头', mealType: 'dinner', tags: ['低卡', '碘'],
    calories: 350, proteinG: 16, carbG: 46, fatG: 8,
    ingredients: ['海带 100g', '北豆腐 100g', '全麦馒头 1 个', '凉拌菠菜 100g'],
    steps: ['海带豆腐同煮 10 分钟', '配馒头与蒜泥菠菜'],
  },
  {
    id: 'r21', name: '苹果 + 原味杏仁', mealType: 'snack', tags: ['便携'],
    calories: 190, proteinG: 3, carbG: 30, fatG: 8,
    ingredients: ['苹果 1 个', '原味杏仁 10 颗'],
    steps: ['直接食用,坚果选原味无盐'],
  },
  {
    id: 'r22', name: '无糖酸奶 + 蓝莓', mealType: 'snack', tags: ['高钙', '低卡'],
    calories: 130, proteinG: 8, carbG: 14, fatG: 4,
    ingredients: ['无糖酸奶 120g', '蓝莓 50g'],
    steps: ['蓝莓洗净铺在酸奶上'],
  },
  {
    id: 'r23', name: '香蕉 + 水煮蛋白', mealType: 'snack', tags: ['运动后'],
    calories: 140, proteinG: 8, carbG: 24, fatG: 1,
    ingredients: ['香蕉 1 根', '鸡蛋清 2 个'],
    steps: ['鸡蛋冷水煮 8 分钟取蛋白', '运动后半小时内搭配食用'],
  },
  {
    id: 'r24', name: '全麦面包 + 花生酱', mealType: 'snack', tags: ['抗饿'],
    calories: 220, proteinG: 8, carbG: 28, fatG: 9,
    ingredients: ['全麦面包 1 片', '无糖花生酱 10g'],
    steps: ['花生酱薄涂一片即可,不宜过厚'],
  },
];
