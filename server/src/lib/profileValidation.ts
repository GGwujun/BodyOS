import { z } from 'zod';

export const ProfileSchema = z.object({
  gender: z.enum(['male','female','other']).optional(),
  birthDate: z.string().datetime().refine(value=>Date.parse(value)<=Date.now(),'出生日期不能晚于今天').nullable().optional(),
  heightCm: z.number().finite().positive().nullable().optional(),
  weightKg: z.number().finite().positive().nullable().optional(),
  activityLevel: z.enum(['sedentary','light','moderate','active','very_active']).optional(),
  dietPreference: z.string().trim().max(500).nullable().optional(),
  trainingPref: z.string().trim().max(500).nullable().optional()
});
