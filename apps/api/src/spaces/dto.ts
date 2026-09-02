import { z } from 'zod';
import { ResourceRole } from '@notesetc/shared';

/** Space key: a short uppercase slug, e.g. "IT", "SECOPS". */
/**
 * Icon id: an optional set prefix (`ms:` material, `si:` simple-icons,
 * `logos:` iconify logos) plus a lowercase name. Names may contain hyphens and
 * dots (e.g. "logos:microsoft-azure"). Bare names (no prefix) are treated as
 * material for backward-compatibility. Shared by spaces and pages.
 */
export const iconId = z
  .string()
  .max(64)
  .regex(/^([a-z]+:)?[a-z0-9_.-]+$/, 'Invalid icon id.');
const iconName = iconId;

export const createSpaceSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[A-Z][A-Z0-9]*$/, 'Key must be uppercase letters/digits, starting with a letter.'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  icon: iconName.optional(),
});
export type CreateSpaceDto = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    icon: iconName.nullable().optional(),
    overview: z.string().max(100_000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required.' });
export type UpdateSpaceDto = z.infer<typeof updateSpaceSchema>;

export const createGrantSchema = z.object({
  principalType: z.enum(['user', 'group']),
  principalId: z.string().min(1),
  role: z.enum([ResourceRole.SpaceAdmin, ResourceRole.Editor, ResourceRole.Viewer]),
});
export type CreateGrantDto = z.infer<typeof createGrantSchema>;

export const updateGrantSchema = z.object({
  role: z.enum([ResourceRole.SpaceAdmin, ResourceRole.Editor, ResourceRole.Viewer]),
});
export type UpdateGrantDto = z.infer<typeof updateGrantSchema>;
