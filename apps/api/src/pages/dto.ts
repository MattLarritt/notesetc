import { z } from 'zod';
import { iconId } from '../spaces/dto';

const CONTENT_MAX = 1_000_000; // ~1MB of Markdown

export const createPageSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().max(CONTENT_MAX).default(''),
  icon: iconId.optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase, hyphen-separated.')
    .optional(),
  parentId: z.string().uuid().optional(),
  changeSummary: z.string().max(500).optional(),
});
export type CreatePageDto = z.infer<typeof createPageSchema>;

export const updatePageSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    content: z.string().max(CONTENT_MAX).optional(),
    icon: iconId.nullable().optional(),
    changeSummary: z.string().max(500).optional(),
    // Optimistic concurrency: the version the edit is based on. A mismatch means
    // someone else edited in the meantime -> 409.
    baseVersionNumber: z.number().int().positive(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined || v.icon !== undefined, {
    message: 'Provide title, content, and/or icon to update.',
  });
export type UpdatePageDto = z.infer<typeof updatePageSchema>;

export const restorePageSchema = z.object({
  versionId: z.string().uuid(),
});
export type RestorePageDto = z.infer<typeof restorePageSchema>;

export const movePageSchema = z.object({
  // undefined = keep current parent (pure reorder); null = move to top level.
  parentId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0),
  // Target space when moving to another space's top level (parentId null). When a
  // parentId is given, the target space is derived from the parent and this is ignored.
  spaceId: z.string().uuid().optional(),
});
export type MovePageDto = z.infer<typeof movePageSchema>;

export const renamePageSchema = z.object({
  title: z.string().min(1).max(300),
});
export type RenamePageDto = z.infer<typeof renamePageSchema>;

const METADATA_MAX_BYTES = 64_000; // serialized cap; keeps a page's metadata bounded

// Integration/tooling metadata: a JSON object keyed by integration namespace. On
// PATCH (merge) a top-level value of null deletes that key, so null is permitted.
export const setMetadataSchema = z
  .object({
    metadata: z.record(z.string(), z.unknown()),
  })
  .superRefine((val, ctx) => {
    if (Array.isArray(val.metadata)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'metadata must be a JSON object, not an array.' });
      return;
    }
    let size = 0;
    try {
      size = JSON.stringify(val.metadata).length;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'metadata must be JSON-serializable.' });
      return;
    }
    if (size > METADATA_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `metadata exceeds the ${METADATA_MAX_BYTES}-byte limit (${size}).`,
      });
    }
  });
export type SetMetadataDto = z.infer<typeof setMetadataSchema>;
