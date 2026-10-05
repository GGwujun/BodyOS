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
}

export interface Goal {
  id: ID;
  type: 'fat_loss' | 'muscle_gain' | 'maintain' | 'endurance';
  targetValue: number;
  unit: string;
  durationWeeks?: number;
  startDate: string;
  progress?: number;
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
  steps?: number;
  startedAt: string;
  source?: string;          // manual|ai_text|wechat|apple_health|...
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
}

/* ============ 每日汇总 ============ */
export interface DailySummary {
  date: string;
  bodyScore: number | null;
  energyScore?: number | null;
  nutritionScore?: number | null;
  activityScore?: number | null;
  recoveryScore?: number | null;
  goalScore?: number | null;
  intakeCalories: number;
  burnCalories: number | null;
  netCalories: number | null;
  steps?: number;
  activeCalories?: number;
  exerciseCalories?: number;
  nutrition: {
    proteinG: number;
    carbG: number;
    fatG: number;
    fiberG?: number;
  };
  goal?: Goal;
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
