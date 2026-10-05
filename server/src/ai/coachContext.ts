import { z } from 'zod';

export const ChatInputSchema = z.object({
  messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().trim().min(1).max(10000)}))
    .min(1).max(100).refine(messages=>messages[messages.length-1]?.role==='user', '最后一条必须是用户消息')
});

interface CoachProfile {
  dietPreference?: string | null;
  trainingPref?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  activityLevel?: string | null;
}

/** Only allowlisted saved profile fields reach the model. Missing values stay missing. */
export function buildCoachContext<T extends Record<string, unknown>>(profile: CoachProfile | null, health: T) {
  return {...health, profile:{
    dietPreference:profile?.dietPreference ?? null,
    trainingPreference:profile?.trainingPref ?? null,
    heightCm:profile?.heightCm ?? null,
    weightKg:profile?.weightKg ?? null,
    activityLevel:profile?.activityLevel ?? null
  }};
}
