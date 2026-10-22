/**
 * 通用 API 类型 — 对应 tech/01 OpenAPI 草案
 */

/** 统一响应包装 */
export interface ApiResponse<T> {
  code: number;     // 0 = 成功
  message: string;
  data: T;
}

/** 业务错误码 */
export interface ApiError {
  code: number;
  message: string;
  /** 是否影响数据(docs/02 错误规范) */
  affectsData?: boolean;
}

/** 分页 */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 标识符 */
export type ID = string;

/* ============ 用户与档案 ============ */
export interface User {
  id: ID;
  nickname: string;
  avatar?: string;
}

export interface Profile {
  gender: 'male' | 'female' | 'other';
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  dietPreference?: string;
  trainingPreference?: string;
  /** 每日步数目标(默认 8000,首页步数条可改) */
  stepGoal?: number;
}

export interface Goal {
  id: ID;
  type: 'fat_loss' | 'muscle_gain' | 'maintain' | 'endurance';
  targetValue: number;
  unit: string;
  durationWeeks?: number;
  startDate: string;
  progress?: number;
  /** 列表默认只返回进行中目标;?all=1 时含归档 */
  isActive?: boolean;
}

/* ============ 饮食 ============ */
export interface FoodItem {
  name: string;
  amount: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG?: number;
  /** 估算克数(三阶段识别返回) */
  grams?: number;
  /** 该项置信度 0-1 */
  confidence?: number;
  /** 营养来源:db 食物库 / llm 估算 */
  source?: 'db' | 'llm';
}

export interface FoodLog {
  id: ID;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  items: FoodItem[];
  totalCalories: number;
  /**
   * 三大营养素合计。服务端一直在存(见 prisma FoodLog),只是客户端这个类型以前没声明,
   * 于是「今天蛋白吃了多少」在记录页也拿不到 —— 类型少一个字段,功能就少一块。
   * 手动只填名字+热量的那种记录三个都是 0(真值,不是缺字段)。
   */
  proteinG: number;
  carbG: number;
  fatG: number;
  loggedAt: string;
  source: 'manual' | 'ai_text' | 'ai_image';
}

/** AI 食物解析入参 */
export interface FoodParseInput {
  text?: string;
  image?: string; // base64 或 OSS url
}

/** AI 食物解析结果(需用户确认) */
export interface FoodParseResult {
  items: FoodItem[];
  confidence: number;
}

/* ============ 活动 / 运动 ============ */
export interface Activity {
  id: ID;
  type: string;
  durationMin?: number;
  calories: number;
  /** 距离(米)。有氧才有;配速由前端用时长/距离算,不另存 */
  distanceM?: number;
  /** 跑步机坡度(%),0.5 一格。口径沿用 openGym 的 incline */
  inclinePct?: number;
  steps?: number;
  startedAt: string;
  source?: string;          // manual|ai_text|wechat|apple_health|...|training
  provider?: string;        // 数据来源
  externalId?: string;
  deduplicated?: boolean;   // 是否被去重合并
}

export interface ActivityParseResult {
  activities: Activity[];
  confidence: number;
}

/* ============ 身体测量 ============ */
export interface BodyMeasurement {
  id: ID;
  measuredAt: string;
  weightKg?: number;
  bodyFatPct?: number;
  muscleKg?: number;
  /** 围度(厘米);一次只量一两处也允许,没量的部位为 null */
  waistCm?: number | null;
  chestCm?: number | null;
  hipCm?: number | null;
  armCm?: number | null;
  thighCm?: number | null;
}

/* ============ 每日汇总 ============ */
/** 引擎算出来的每日宏量目标(资料不全时为 null —— 不给按默认体重猜的目标)。
 *  /trends 和 /daily-summary 返回同一形状(公式在 server engine/nutrition.macroTargetView)。
 *  定义放这儿(而不是 trends.ts)是因为 daily-summary 也带它 —— 两处共用一个类型。 */
export interface MacroTarget {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface DailySummary {
  date: string;
  bodyScore: number | null;
  energyScore?: number | null;
  nutritionScore?: number | null;
  activityScore?: number | null;
  recoveryScore?: number | null;
  goalScore?: number | null;
  intakeCalories: number;
  /**
   * 消耗 = 基础代谢 + 日常活动 + 运动消耗(见 server/src/engine/energy.ts)。
   * 三个组成项都是分开返回的 —— 首页那张能量卡要说清「这个数是怎么来的」,
   * 而**TDEE 故意不进这个和**:它本身就含基础代谢,再加一遍就是重复计。
   */
  burnCalories: number | null;
  netCalories: number | null;
  /** 基础代谢(Mifflin-St Jeor)。没填性别/年龄/身高/体重时为 null */
  bmr?: number | null;
  /** 每日总消耗估算(基础代谢 × 活动系数)。只用来定热量目标,不参与 burnCalories 求和 */
  tdee?: number | null;
  steps?: number;
  /** 日常活动消耗 —— 没有 durationMin 的记录(步数换算的那部分) */
  activeCalories?: number;
  /** 运动消耗 —— 有 durationMin 的记录(手动记的、同步来的、力量训练回写的) */
  exerciseCalories?: number;
  /** 当日水分合计(毫升) */
  waterMl?: number;
  /** 昨晚睡眠时长(分钟)。没记过就是 0(真值不是缺字段,和 waterMl 同口径) */
  sleepMinutes?: number;
  nutrition: {
    proteinG: number;
    carbG: number;
    fatG: number;
    fiberG?: number;
  };
  goal?: Goal;
  /** 身体资料够不够算基础代谢/评分;缺的时候 `missingProfile` 说要补哪几项 */
  profileReady?: boolean;
  missingProfile?: ('birthDate' | 'heightCm' | 'weightKg')[];
  /** 每日宏量目标(蛋白/碳水/脂肪该吃多少)。饮食页「今天的营养」对当日摄入用;没有目标时为 null */
  macroTarget?: MacroTarget | null;
  /** 每日步数目标(档案里自己定的,默认 8000)—— 首页步数条的另一半 */
  stepGoal?: number;
}

/** AI 每日分析(结论 / 依据 / 行动) */
export interface DailyAnalysis {
  summary: string;
  highlights: string[];
  issues: string[];
  actions: { title: string; reason: string }[];
}

export interface WeeklyAnalysis {
  score: number;
  grade: string;
  changes: { label: string; value: string }[];
  wins: string[];
  issues: string[];
  actions: string[];
  /** 命中服务端周缓存时为 true */
  cached?: boolean;
}

/* ============ AI 教练 ============ */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  context?: Record<string, unknown>;
}

export interface ChatResult {
  reply: string;
  references?: { type: string; id: ID; label: string }[];
}

/* ============ 水分打卡 ============ */
export interface WaterStatus {
  date: string;
  amountMl: number;
  goalMl: number;
}

/** 配料表解析结果 */
export interface IngredientScanResult {
  ingredients: string[];
  notes: { level: 'info' | 'warn'; text: string }[];
}

/* ============ 常用食物库 ============ */
/** 近 30 天高频食物(按记录次数聚合,均值营养) */
export interface FrequentFood {
  name: string;
  count: number;
  amount: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

/** 我的食物 —— 用户显式存的条目(同名同份量再存即覆盖数字) */
export interface CustomFood {
  id: string;
  name: string;
  amount: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  createdAt: string;
}

/* ============ 数据源 ============ */
export type Provider = 'wechat' | 'apple_health' | 'mi' | 'huami';
export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'synced' | 'error';

export interface DataSource {
  provider: Provider;
  name: string;
  status: SyncStatus;
  available: boolean;
  unavailableReason?: string | null;
  hasStoredConnection?: boolean;
  lastError?: string | null;
  lastSyncAt?: string;
  permissions?: string[];
}
