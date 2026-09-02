import { z } from 'zod';

export const createCommentSchema = z.object({
  body: z.string().min(1, 'A comment cannot be empty.').max(10_000),
  parentId: z.string().uuid().nullable().optional(),
});
export type CreateCommentDto = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  body: z.string().min(1, 'A comment cannot be empty.').max(10_000),
});
export type UpdateCommentDto = z.infer<typeof updateCommentSchema>;

export const resolveCommentSchema = z.object({
  resolved: z.boolean(),
});
export type ResolveCommentDto = z.infer<typeof resolveCommentSchema>;
