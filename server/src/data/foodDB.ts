/**
 * 内置精简食物成分表
 * 数据来源:中国食物成分表(标准值)/ USDA 公开数据,均为每 100g 可食部。
 * 用途:校准 AI 食物识别的热量与宏量,避免 LLM 编造数字。
 *
 * 命中策略:exact(名称/别名) → 包含匹配 → 词元匹配 → 未命中(low confidence)
 */

export interface FoodEntry {
  /** 主名称 */
  name: string;
  /** 别名/常见写法,匹配时一并检索 */
  aliases?: string[];
  category: string;
  /** 每 100g */
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG?: number;
  /** 常见份量参考(g),用于 AI 无明确克数时估算 */
  commonPortionG?: number;
}

export const FOOD_DB: FoodEntry[] = [
  // ===== 主食 / 谷物 =====
  { name: '米饭', aliases: ['白米饭', '大米饭', '粳米饭'], category: '主食', kcal: 116, proteinG: 2.6, carbG: 25.9, fatG: 0.3, commonPortionG: 200 },
  { name: '糙米饭', aliases: ['糙米'], category: '主食', kcal: 112, proteinG: 2.6, carbG: 22.9, fatG: 0.9, commonPortionG: 150 },
  { name: '面条', aliases: ['白面', '挂面', '煮面'], category: '主食', kcal: 110, proteinG: 3.5, carbG: 24.3, fatG: 0.1, commonPortionG: 200 },
  { name: '牛肉面', aliases: ['兰州拉面', '牛腩面'], category: '主食', kcal: 130, proteinG: 6.5, carbG: 16.5, fatG: 4.5, commonPortionG: 500 },
  { name: '馒头', aliases: ['白面馒头'], category: '主食', kcal: 223, proteinG: 7.0, carbG: 47.0, fatG: 1.1, commonPortionG: 100 },
  { name: '包子', category: '主食', kcal: 227, proteinG: 8.4, carbG: 38.0, fatG: 4.0, commonPortionG: 100 },
  { name: '饺子', aliases: ['水饺'], category: '主食', kcal: 240, proteinG: 9.0, carbG: 30.0, fatG: 8.0, commonPortionG: 30 },
  { name: '面包', aliases: ['白面包', '切片面包', '全麦面包'], category: '主食', kcal: 313, proteinG: 8.3, carbG: 58.6, fatG: 5.1, commonPortionG: 80 },
  { name: '燕麦', aliases: ['燕麦片', '麦片', 'oatmeal'], category: '主食', kcal: 367, proteinG: 15.0, carbG: 61.0, fatG: 6.7, commonPortionG: 50 },
  { name: '红薯', aliases: ['地瓜', '番薯'], category: '主食', kcal: 86, proteinG: 1.6, carbG: 20.0, fatG: 0.1, commonPortionG: 200 },
  { name: '玉米', aliases: ['甜玉米', '苞谷'], category: '主食', kcal: 86, proteinG: 3.3, carbG: 19.0, fatG: 1.2, commonPortionG: 150 },
  { name: '土豆', aliases: ['马铃薯', '洋芋'], category: '主食', kcal: 77, proteinG: 2.0, carbG: 17.0, fatG: 0.1, commonPortionG: 150 },

  // ===== 肉类 =====
  { name: '鸡胸肉', aliases: ['鸡胸', '鸡脯肉'], category: '肉蛋', kcal: 133, proteinG: 31.0, carbG: 0, fatG: 1.2, commonPortionG: 150 },
  { name: '鸡腿', aliases: ['鸡腿肉'], category: '肉蛋', kcal: 181, proteinG: 24.0, carbG: 0, fatG: 9.0, commonPortionG: 150 },
  { name: '瘦猪肉', aliases: ['猪肉', '猪瘦肉'], category: '肉蛋', kcal: 143, proteinG: 20.3, carbG: 0, fatG: 6.2, commonPortionG: 100 },
  { name: '瘦牛肉', aliases: ['牛肉', '牛腱'], category: '肉蛋', kcal: 106, proteinG: 20.2, carbG: 0, fatG: 2.3, commonPortionG: 100 },
  { name: '牛排', aliases: ['steak'], category: '肉蛋', kcal: 250, proteinG: 26.0, carbG: 0, fatG: 17.0, commonPortionG: 200 },
  { name: '培根', aliases: ['烟肉'], category: '肉蛋', kcal: 459, proteinG: 13.0, carbG: 1.4, fatG: 45.0, commonPortionG: 30 },

  // ===== 水产 =====
  { name: '三文鱼', aliases: ['鲑鱼', 'salmon'], category: '水产', kcal: 139, proteinG: 17.2, carbG: 0, fatG: 7.8, commonPortionG: 100 },
  { name: '虾', aliases: ['基围虾', '大虾', '虾仁'], category: '水产', kcal: 87, proteinG: 18.6, carbG: 0, fatG: 1.1, commonPortionG: 100 },
  { name: '金枪鱼', aliases: ['吞拿鱼', 'tuna'], category: '水产', kcal: 130, proteinG: 28.0, carbG: 0, fatG: 1.0, commonPortionG: 100 },
  { name: '带鱼', category: '水产', kcal: 127, proteinG: 17.7, carbG: 0, fatG: 4.9, commonPortionG: 100 },

  // ===== 蛋类 =====
  { name: '鸡蛋', aliases: ['土鸡蛋', '白煮蛋', '煎蛋', '荷包蛋'], category: '肉蛋', kcal: 144, proteinG: 13.3, carbG: 1.5, fatG: 8.8, commonPortionG: 50 },
  { name: '蛋白', aliases: ['蛋清'], category: '肉蛋', kcal: 48, proteinG: 11.0, carbG: 1.1, fatG: 0.1, commonPortionG: 35 },

  // ===== 豆制品 / 乳制品 =====
  { name: '豆腐', aliases: ['北豆腐'], category: '豆乳', kcal: 81, proteinG: 8.1, carbG: 1.9, fatG: 3.7, commonPortionG: 150 },
  { name: '豆浆', category: '豆乳', kcal: 31, proteinG: 3.0, carbG: 1.2, fatG: 1.6, commonPortionG: 250 },
  { name: '牛奶', aliases: ['纯牛奶'], category: '豆乳', kcal: 54, proteinG: 3.0, carbG: 3.4, fatG: 3.2, commonPortionG: 250 },
  { name: '脱脂牛奶', aliases: ['低脂牛奶'], category: '豆乳', kcal: 35, proteinG: 3.4, carbG: 5.0, fatG: 0.1, commonPortionG: 250 },
  { name: '酸奶', aliases: ['希腊酸奶', '原味酸奶'], category: '豆乳', kcal: 72, proteinG: 2.5, carbG: 9.3, fatG: 2.7, commonPortionG: 150 },
  { name: '奶酪', aliases: ['芝士', 'cheese'], category: '豆乳', kcal: 328, proteinG: 25.7, carbG: 3.5, fatG: 23.5, commonPortionG: 30 },

  // ===== 蔬菜(低热量,常见) =====
  { name: '西兰花', aliases: ['绿菜花', '花椰菜'], category: '蔬菜', kcal: 36, proteinG: 4.1, carbG: 4.3, fatG: 0.6, commonPortionG: 150 },
  { name: '菠菜', category: '蔬菜', kcal: 28, proteinG: 2.6, carbG: 4.5, fatG: 0.3, commonPortionG: 150 },
  { name: '生菜', aliases: ['莴苣'], category: '蔬菜', kcal: 16, proteinG: 1.4, carbG: 2.9, fatG: 0.4, commonPortionG: 100 },
  { name: '番茄', aliases: ['西红柿'], category: '蔬菜', kcal: 20, proteinG: 0.9, carbG: 4.0, fatG: 0.2, commonPortionG: 150 },
  { name: '黄瓜', category: '蔬菜', kcal: 16, proteinG: 0.8, carbG: 2.9, fatG: 0.2, commonPortionG: 150 },
  { name: '胡萝卜', category: '蔬菜', kcal: 41, proteinG: 1.0, carbG: 9.6, fatG: 0.2, commonPortionG: 100 },
  { name: '白菜', aliases: ['大白菜'], category: '蔬菜', kcal: 20, proteinG: 1.5, carbG: 3.4, fatG: 0.1, commonPortionG: 200 },
  { name: '蘑菇', aliases: ['香菇', '金针菇', '菌菇'], category: '蔬菜', kcal: 24, proteinG: 2.7, carbG: 4.1, fatG: 0.1, commonPortionG: 100 },

  // ===== 水果 =====
  { name: '苹果', category: '水果', kcal: 54, proteinG: 0.2, carbG: 13.5, fatG: 0.2, fiberG: 1.2, commonPortionG: 200 },
  { name: '香蕉', category: '水果', kcal: 93, proteinG: 1.4, carbG: 22.2, fatG: 0.2, fiberG: 1.2, commonPortionG: 120 },
  { name: '橙子', aliases: ['脐橙', '柳橙'], category: '水果', kcal: 48, proteinG: 0.8, carbG: 11.1, fatG: 0.2, fiberG: 0.6, commonPortionG: 200 },
  { name: '葡萄', category: '水果', kcal: 45, proteinG: 0.5, carbG: 10.3, fatG: 0.2, commonPortionG: 100 },
  { name: '西瓜', category: '水果', kcal: 30, proteinG: 0.6, carbG: 7.6, fatG: 0.1, commonPortionG: 300 },
  { name: '蓝莓', aliases: ['草莓', '浆果'], category: '水果', kcal: 57, proteinG: 0.7, carbG: 14.5, fatG: 0.3, fiberG: 2.4, commonPortionG: 100 },
  { name: '芒果', category: '水果', kcal: 60, proteinG: 0.8, carbG: 15.0, fatG: 0.4, commonPortionG: 150 },

  // ===== 坚果 / 油脂 =====
  { name: '杏仁', aliases: ['巴旦木'], category: '坚果', kcal: 578, proteinG: 21.0, carbG: 21.6, fatG: 49.4, commonPortionG: 28 },
  { name: '核桃', category: '坚果', kcal: 654, proteinG: 14.9, carbG: 19.1, fatG: 58.8, commonPortionG: 28 },
  { name: '花生', aliases: ['花生米'], category: '坚果', kcal: 567, proteinG: 25.8, carbG: 16.1, fatG: 49.2, commonPortionG: 28 },
  { name: '橄榄油', aliases: ['油'], category: '油脂', kcal: 884, proteinG: 0, carbG: 0, fatG: 100, commonPortionG: 10 },

  // ===== 饮品 / 其他 =====
  { name: '黑咖啡', aliases: ['美式', '咖啡'], category: '饮品', kcal: 2, proteinG: 0.1, carbG: 0, fatG: 0, commonPortionG: 250 },
  { name: '拿铁', aliases: ['latte'], category: '饮品', kcal: 56, proteinG: 3.0, carbG: 4.5, fatG: 3.0, commonPortionG: 350 },
  { name: '可乐', category: '饮品', kcal: 43, proteinG: 0, carbG: 10.6, fatG: 0, commonPortionG: 330 },
  { name: '啤酒', category: '饮品', kcal: 43, proteinG: 0.5, carbG: 3.6, fatG: 0, commonPortionG: 500 }
];

/** 全部候选名(名称 + 别名)与 entry 的映射,用于快速匹配 */
interface NameIndex {
  text: string;
  entry: FoodEntry;
}
const INDEX: NameIndex[] = FOOD_DB.flatMap((entry) => [
  { text: entry.name.toLowerCase(), entry },
  ...(entry.aliases ?? []).map((a) => ({ text: a.toLowerCase(), entry }))
]).sort((a, b) => b.text.length - a.text.length); // 长名优先,避免"鸡胸肉"被"鸡肉"抢先

export interface MatchResult {
  entry: FoodEntry;
  /** 匹配方式 */
  via: 'exact' | 'contains';
  /** 0-1,exact=1, contains=0.85 */
  confidence: number;
}

/** 常见烹饪/修饰词,匹配时剥离以提高命中率 */
const MODIFIERS = [
  '清蒸', '红烧', '煎', '炒', '炸', '烤', '煮', '蒸', '炖', '卤', '凉拌', '爆', '焖',
  '块', '片', '丁', '丝', '条', '末', '一份', '一盘', '一碗', '一个', '半个',
  '新鲜', '瘦', '肥', '生', '熟', '大', '小'
];

/** 剥离修饰词,得到食物核心名 */
function coreName(name: string): string {
  let n = name;
  for (const m of MODIFIERS) {
    n = n.split(m).join('');
  }
  return n.trim();
}

/** 在食物库中查找最匹配的条目 */
export function matchFood(query: string): MatchResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // 精确匹配
  const exact = INDEX.find((i) => i.text === q);
  if (exact) return { entry: exact.entry, via: 'exact', confidence: 1 };

  // 包含匹配(长名优先,已在 INDEX 排序)
  const contains = INDEX.find((i) => q.includes(i.text) || i.text.includes(q));
  if (contains) return { entry: contains.entry, via: 'contains', confidence: 0.85 };

  // 剥离修饰词后再匹配(如"红烧瘦牛肉丁" → "牛肉")
  const core = coreName(q);
  if (core && core !== q) {
    const coreExact = INDEX.find((i) => i.text === core);
    if (coreExact) return { entry: coreExact.entry, via: 'contains', confidence: 0.8 };
    const coreContains = INDEX.find((i) => core.includes(i.text) || i.text.includes(core));
    if (coreContains) return { entry: coreContains.entry, via: 'contains', confidence: 0.8 };
  }

  return null;
}
