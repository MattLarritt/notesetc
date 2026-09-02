import { MIN_PASSWORD_LENGTH } from '@notesetc/shared';
import { z } from 'zod';

/**
 * Bootstrap configuration ONLY. Per the design, env holds just what's needed to
 * start: DB connection, breakglass admin, the master encryption key, and ports.
 * All ongoing/operational config lives in the `settings` table and is managed
 * in-app.
 *
 * Breakglass rule: if BREAKGLASS_ADMIN_EMAIL is absent, the breakglass account
 * is DISABLED on boot (enforced in the bootstrap service, not here).
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4100),

  /** Public base URL of the web app, used for CORS + links in audit/proposals. */
  WEB_ORIGIN: z.string().url().default('http://localhost:3100'),

  /** Prisma connection string. Postgres in POC, MSSQL (sqlserver://) in prod. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * 32-byte key (base64 or hex) used to encrypt sensitive `settings` values at
   * rest (AES-256-GCM). Required outside development.
   */
  MASTER_ENCRYPTION_KEY: z.string().optional(),

  /** Breakglass local admin bootstrap. Absent email => account disabled. */
  BREAKGLASS_ADMIN_EMAIL: z.string().email().optional(),
  /** Either a plaintext password (hashed on boot) or a pre-computed argon2 hash. */
  BREAKGLASS_ADMIN_PASSWORD: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  BREAKGLASS_ADMIN_PASSWORD_HASH: z.string().optional(),

  /** Session cookie signing secret (web auth). Required outside development. */
  SESSION_SECRET: z.string().min(16).optional(),

  /**
   * Directory where uploaded attachment bytes live. A plain volume path, kept
   * OUT of the web root — files are only ever served through the auth-gated
   * /attachments/:id endpoint. Defaults to ./var/uploads under the process cwd.
   */
  STORAGE_DIR: z.string().default('./var/uploads'),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Parse + validate process.env. Throws with a readable message on misconfig so
 * the container fails fast rather than starting in an unsafe state.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Treat empty-string env vars (common when a key is present but blank in .env)
  // as absent, so optional fields fall back to defaults instead of failing.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }

  const parsed = configSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const cfg = parsed.data;

  // Production safety gates: secrets that are optional in dev are mandatory here.
  if (cfg.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!cfg.MASTER_ENCRYPTION_KEY) missing.push('MASTER_ENCRYPTION_KEY');
    if (!cfg.SESSION_SECRET) missing.push('SESSION_SECRET');
    if (missing.length) {
      throw new Error(`Missing required production config: ${missing.join(', ')}`);
    }
  }

  return cfg;
}
