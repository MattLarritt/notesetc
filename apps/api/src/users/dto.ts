import { z } from 'zod';
import { GlobalRole, MIN_PASSWORD_LENGTH } from '@notesetc/shared';

export const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(512),
  globalRole: z.enum([GlobalRole.GlobalAdmin, GlobalRole.Member]).default(GlobalRole.Member),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    status: z.enum(['active', 'disabled']).optional(),
    globalRole: z.enum([GlobalRole.GlobalAdmin, GlobalRole.Member]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
