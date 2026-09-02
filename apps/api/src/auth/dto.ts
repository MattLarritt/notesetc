import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(512),
});

export type LoginDto = z.infer<typeof loginSchema>;
