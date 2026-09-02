import { z } from 'zod';

export const createTokenSchema = z.object({
  name: z.string().min(1).max(120),
  /** Defaults to the creating admin. */
  ownerUserId: z.string().min(1).optional(),
  /** Restrict the token to these spaces (subset of the owner's access). */
  allowedSpaceIds: z.array(z.string().min(1)).optional(),
  /** Optional expiry, in days from now. */
  expiresInDays: z.number().int().positive().max(3650).optional(),
});
export type CreateTokenDto = z.infer<typeof createTokenSchema>;
