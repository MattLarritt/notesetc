import { z } from 'zod';

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateTemplateDto = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    content: z.string().max(1_000_000).optional(),
  })
  .refine((v) => v.name !== undefined || v.content !== undefined, {
    message: 'Provide name and/or content.',
  });
export type UpdateTemplateDto = z.infer<typeof updateTemplateSchema>;

export const setTemplateRefSchema = z.object({
  templateId: z.string().uuid().nullable(),
});
export type SetTemplateRefDto = z.infer<typeof setTemplateRefSchema>;
