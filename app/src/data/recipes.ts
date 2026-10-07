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
  qa: { q: string; a: string };
}

export const RECIPE_MEALS: { key: RecipeMeal | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
  { key: 'snack', label: '加餐' },
];

const BASE_RECIPE_ROWS: Omit<Recipe, 'qa'>[] = [
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

/** 每个食谱搭配一条问答(营养常识,供详情页展示) */
const QA_MAP: Record<string, { q: string; a: string }> = {
  r01: { q: '燕麦早上吃真的抗饿吗?', a: '燕麦的 β-葡聚糖延缓胃排空,饱腹感比白粥强得多;选需要煮的生燕麦片,即食脆麦片糖多效果差。' },
  r02: { q: '早餐吃鸡蛋会胆固醇超标吗?', a: '对多数健康人,每天 1~2 个整蛋没问题,蛋黄里的卵磷脂还有益于脂质代谢,不必只吃蛋白。' },
  r03: { q: '喝粥养胃但容易饿怎么办?', a: '粥消化快确实容易饿,搭配鸡蛋或一点瘦肉蛋白,再配玉米薯类等粗粮,饱腹时间明显更长。' },
  r04: { q: '包子配豆浆当早餐够营养吗?', a: '碳水和植物蛋白有了,再补一份水果或黄瓜番茄,维生素和膳食纤维就齐了,是很实惠的搭配。' },
  r05: { q: '无糖酸奶会不会太难吃?', a: '水果的天然甜味能中和酸感;市面"风味酸奶"常加 10g 以上糖,买时看配料表选无蔗糖的。' },
  r06: { q: '牛奶早上喝还是晚上喝好?', a: '时间影响不大,每天 300ml 左右补钙是关键;乳糖不耐受胀肚的话换无糖酸奶或低乳糖奶。' },
  r07: { q: '藜麦真的比米饭好吗?', a: '藜麦蛋白和纤维更高、升糖更慢,但热量与米饭接近,控制总量仍然是关键,不是"换着多吃"。' },
  r08: { q: '牛腩脂肪高,减脂期能吃吗?', a: '炖后撇油、控制 80g 左右的量完全没问题;红肉补铁,每周吃 2~3 次比完全不吃更均衡。' },
  r09: { q: '清蒸鱼怎么做不腥?', a: '鱼身划刀塞姜丝,水开后大火蒸 8 分钟,出锅倒掉盘中汁水再淋豉油,腥味就去掉大半。' },
  r10: { q: '虾仁滑蛋为什么蛋总是老?', a: '蛋液加一点水淀粉,锅温别太高、凝固一半就关火用余温焖,蛋才嫩滑。' },
  r11: { q: '荞麦面适合减脂吃吗?', a: '荞麦面升糖指数比白面低、饱腹更强,但一碗干面 70g 热量不低,注意别配重油浇头。' },
  r12: { q: '炒饭想少油还好吃?', a: '用隔夜冷藏的米饭,蛋液先拌进饭里再下锅,一点油就能炒散炒香,最后加彩椒提味。' },
  r13: { q: '沙拉当午饭会不会不够?', a: '纯蔬菜沙拉容易下午饿,像这样加藜麦、鸡蛋和油醋汁,碳水和蛋白都有,才扛得住一下午。' },
  r14: { q: '晚上喝汤会水肿吗?', a: '正常喝一碗咸淡适口的汤不会,注意少放盐;水肿多与高钠饮食和久坐有关,不是汤本身。' },
  r15: { q: '鸡腿去皮能省多少热量?', a: '鸡皮贡献了鸡腿近一半脂肪,去皮一只大约少 60~80 千卡,蒸熟后撕皮比生撕更容易。' },
  r16: { q: '龙利鱼是"科技鱼"吗?', a: '龙利鱼是深海鱼切片,钠含量略高但正规渠道购买没问题;怕腥、怕刺选它做日常蛋白很方便。' },
  r17: { q: '晚餐只吃蔬菜行不行?', a: '短期掉秤快,但蛋白不够会掉肌肉、易反弹;加个鸡蛋或豆腐,饱腹和营养都更好。' },
  r18: { q: '白灼虾蘸料怎么选?', a: '姜醋汁比酱油料热量低得多;虾本身高蛋白低脂,别用油炸或重油蒜蓉做法就很好。' },
  r19: { q: '紫薯当晚餐主食会胖吗?', a: '紫薯热量比同重量米饭低,富含纤维和花青素,吃 120g 左右替代米饭反而是减脂好选择。' },
  r20: { q: '海带吃多了碘会超标吗?', a: '一周吃两三次、每次一小碗没问题;甲亢或需限碘人群遵医嘱控制即可。' },
  r21: { q: '水果当加餐会不会糖太多?', a: '一份水果约 15~20g 天然糖,搭配坚果的脂肪和蛋白,血糖更平稳,比饼干蛋糕强得多。' },
  r22: { q: '酸奶什么时候吃最好?', a: '加餐或餐后都可以,肠胃敏感的人避免空腹;关键是选无糖,果粒酸奶糖往往不低。' },
  r23: { q: '运动后必须马上吃蛋白吗?', a: '练完两小时内补充碳水和蛋白都有助恢复,一根香蕉加两个蛋白就是简单实惠的组合。' },
  r24: { q: '花生酱不是很油吗?', a: '花生酱脂肪多但以不饱和脂肪为主,10g 约一瓷勺,抹薄一点配全麦面包,抗饿又可控。' },
};

export const RECIPES: Recipe[] = BASE_RECIPE_ROWS.map((r) => ({ ...r, qa: QA_MAP[r.id] }));
