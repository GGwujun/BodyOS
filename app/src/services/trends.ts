import { request } from './request';

export interface TrendDay {
  date: string;
  bodyScore: number | null;
  energyScore: number | null;
  nutritionScore: number | null;
  activityScore: number | null;
  recoveryScore: number | null;
  goalScore: number | null;
  intakeCalories: number;
  burnCalories: number | null;
  netCalories: number | null;
  steps: number;
}

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export interface TrendResult {
  range: number;
  summaries: TrendDay[];
  weights: WeightPoint[];
  stats: {
    avgScore: number | null;
    currentWeight: number | null;
    weightChange: number | null;
    recordDays: number;
  };
}

/** GET /trends?range=7|30|90 */
export const getTrends = (range: number) =>
  request<TrendResult>({ url: `/trends?range=${range}` });
