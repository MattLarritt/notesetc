import { z } from 'zod';

export const setScheduleSchema = z.object({
  intervalDays: z.number().int().positive().max(3650).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});
export type SetScheduleDto = z.infer<typeof setScheduleSchema>;

export const addMaintainerSchema = z.object({
  principalType: z.enum(['user', 'group']),
  principalId: z.string().min(1),
});
export type AddMaintainerDto = z.infer<typeof addMaintainerSchema>;
