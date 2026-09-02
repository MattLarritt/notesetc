import { z } from 'zod';
import { AutomationTriggerType, PageEventType } from '@notesetc/shared';

const SCRIPT_MAX = 200_000; // 200 KB of JS is plenty for an automation

const pageEventConfigSchema = z.object({
  events: z
    .array(z.enum([PageEventType.Created, PageEventType.Updated, PageEventType.Moved, PageEventType.Deleted]))
    .min(1),
  spaceIds: z.array(z.string().uuid()).optional(),
});

const scheduleConfigSchema = z.object({
  cron: z.string().min(1).max(120),
  timezone: z
    .string()
    .max(64)
    .optional()
    .refine(
      (tz) => {
        if (!tz) return true;
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Unknown timezone.' },
    ),
});

const webhookConfigSchema = z.object({}).passthrough();

/** Validate triggerConfig against the shape its triggerType demands. */
export function validateTriggerConfig(
  triggerType: string,
  config: unknown,
): Record<string, unknown> {
  switch (triggerType) {
    case AutomationTriggerType.PageEvent:
      return pageEventConfigSchema.parse(config ?? {});
    case AutomationTriggerType.Schedule:
      return scheduleConfigSchema.parse(config ?? {});
    case AutomationTriggerType.Webhook:
      return webhookConfigSchema.parse(config ?? {});
    default:
      throw new Error(`Unknown trigger type "${triggerType}".`);
  }
}

export const createAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().default(false),
  triggerType: z.enum([
    AutomationTriggerType.PageEvent,
    AutomationTriggerType.Schedule,
    AutomationTriggerType.Webhook,
  ]),
  triggerConfig: z.record(z.string(), z.unknown()).default({}),
  script: z.string().max(SCRIPT_MAX).default(''),
  timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
  debugMode: z.boolean().default(false),
  /** Webhook trigger only; defaults to a slug derived from the name. */
  webhookSlug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase, hyphen-separated.')
    .optional(),
});
export type CreateAutomationDto = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  script: z.string().max(SCRIPT_MAX).optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  debugMode: z.boolean().optional(),
  webhookSlug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
});
export type UpdateAutomationDto = z.infer<typeof updateAutomationSchema>;

export const testAutomationSchema = z.object({
  /** Dry-run: reads are real, writes intercepted + logged. */
  mockMode: z.boolean().default(true),
  /** Optional simulated trigger payload (merged over a sane default). */
  simulatedEvent: z.record(z.string(), z.unknown()).optional(),
});
export type TestAutomationDto = z.infer<typeof testAutomationSchema>;

export const setVariableSchema = z.object({
  value: z.string().max(64_000),
  isSecure: z.boolean().default(false),
});
export type SetVariableDto = z.infer<typeof setVariableSchema>;

export const variableNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Variable names may contain letters, digits, _ . -');
