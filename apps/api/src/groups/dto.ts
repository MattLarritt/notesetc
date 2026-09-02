import { z } from 'zod';

export const createGroupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});
export type CreateGroupDto = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required.' });
export type UpdateGroupDto = z.infer<typeof updateGroupSchema>;

export const addMemberSchema = z.object({ userId: z.string().min(1) });
export type AddMemberDto = z.infer<typeof addMemberSchema>;
