import { z } from 'zod';

export const ProfileSchema = z.object({
  gender: z.enum(['male','female','other']).optional(),
  birthDate: z.string().datetime().refine(value=>Date.parse(value)<=Date.now(),'出生日期不能晚于今天').nullable().optional(),
  heightCm: z.number().finite().positive().max(250,'身高超出合理范围').nullable().optional(),
  weightKg: z.number().finite().positive().max(400,'体重超出合理范围').nullable().optional(),
  activityLevel: z.enum(['sedentary','light','moderate','active','very_active']).optional(),
  stepGoal: z.number().int().finite().min(1000,'步数目标至少 1000').max(50000,'步数目标超出合理范围').optional(),
  dietPreference: z.string().trim().max(500).nullable().optional(),
  trainingPref: z.string().trim().max(500).nullable().optional()
});
