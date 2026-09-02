import { z } from 'zod';

export const createProposalSchema = z.object({
  proposedContent: z.string().max(1_000_000),
  proposedTitle: z.string().min(1).max(300).optional(),
  rationale: z.string().max(2000).optional(),
});
export type CreateProposalDto = z.infer<typeof createProposalSchema>;
