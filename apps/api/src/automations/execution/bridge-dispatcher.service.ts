import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Principal } from '@notesetc/shared';
import type { AuditContext } from '../../audit/audit.service';
import { PagesService } from '../../pages/pages.service';
import { SpaceRepository } from '../../repositories/space.repository';
import { automationCallContext } from './run-context';
import { VariableResolver } from './variable-resolver.service';

/** Everything the dispatcher needs to execute one netc.* call for a run. */
export interface DispatchContext {
  runId: string;
  automationId: string;
  principal: Principal;
  auditCtx: AuditContext;
  /** Mock mode: intercept writes (and all fetch), log what would happen. */
  dryRun: boolean;
  /** Chain depth of the current run (loop guard). */
  depth: number;
  /** Sink for dispatcher-generated log entries (mock notices). */
  log: (entry: { source: string; state: string; message: string; data?: unknown }) => void;
  /** Register a secure value so the run's log pipeline redacts it. */
  registerSecret: (value: string) => void;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

// ---- argument schemas (same validation live and mock, so dry runs catch shape bugs)
const idSchema = z.string().uuid();
const optsSchema = z.object({ allowTriggers: z.boolean().optional() }).optional();
const metadataOptsSchema = z
  .object({ allowTriggers: z.boolean().optional(), merge: z.boolean().optional() })
  .optional();
const createInputSchema = z.object({
  spaceId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  content: z.string().max(1_000_000).default(''),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  icon: z.string().max(120).optional(),
  changeSummary: z.string().max(500).optional(),
});
const updateDataSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    content: z.string().max(1_000_000).optional(),
    changeSummary: z.string().max(500).optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: 'Provide title and/or content.',
  });
const moveDtoSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0),
  spaceId: z.string().uuid().optional(),
});
const metadataValueSchema = z.record(z.string(), z.unknown());
const fetchOptsSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().max(1_000_000).optional(),
  })
  .optional();

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_BODY_CAP = 1_000_000; // 1 MB of response text

/**
 * Host side of the netc.* bridge: validates worker RPC calls, applies mock-mode
 * interception, wraps live calls in the automation run context (loop guard),
 * and maps everything onto the existing service layer so authz/audit/versioning
 * behave exactly as for any other caller.
 */
@Injectable()
export class BridgeDispatcher {
  constructor(
    private readonly pages: PagesService,
    private readonly spaces: SpaceRepository,
    private readonly variables: VariableResolver,
  ) {}

  async dispatch(ctx: DispatchContext, method: string, args: unknown[]): Promise<unknown> {
    try {
      return await this.route(ctx, method, args);
    } catch (err) {
      throw this.toBridgeError(err);
    }
  }

  private toBridgeError(err: unknown): BridgeError {
    if (err instanceof BridgeError) return err;
    if (err instanceof z.ZodError) {
      return new BridgeError(`Invalid arguments: ${err.issues.map((i) => i.message).join('; ')}`, 'invalid_args');
    }
    if (err instanceof NotFoundException) return new BridgeError(err.message, 'not_found');
    if (err instanceof ConflictException) return new BridgeError(err.message, 'conflict');
    if (err instanceof ForbiddenException) return new BridgeError(err.message, 'denied');
    if (err instanceof BadRequestException) return new BridgeError(err.message, 'bad_request');
    const msg = err instanceof Error ? err.message : String(err);
    return new BridgeError(msg, 'internal');
  }

  /** Run a live service call inside the loop-guard context. */
  private inRunContext<T>(ctx: DispatchContext, allowTriggers: boolean, fn: () => Promise<T>): Promise<T> {
    return automationCallContext.run(
      { runId: ctx.runId, allowTriggers, depth: ctx.depth },
      fn,
    );
  }

  private async route(ctx: DispatchContext, method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      // ---- reads (always live, even in mock mode) ----
      case 'pages.get': {
        const id = idSchema.parse(args[0]);
        const d = await this.pages.getById(ctx.principal, id, ctx.auditCtx);
        return {
          page: d.page,
          content: d.version?.content ?? null,
          versionNumber: d.version?.versionNumber ?? null,
        };
      }
      case 'pages.children': {
        const id = idSchema.parse(args[0]);
        const d = await this.pages.getById(ctx.principal, id, ctx.auditCtx);
        return this.pages.list(ctx.principal, d.page.spaceId, ctx.auditCtx, id);
      }
      case 'pages.findByPath': {
        const spaceKey = z.string().min(1).parse(args[0]);
        const path = z.string().min(1).parse(args[1]);
        try {
          const d = await this.pages.getByPath(ctx.principal, spaceKey, path, ctx.auditCtx);
          return {
            page: d.page,
            content: d.version?.content ?? null,
            versionNumber: d.version?.versionNumber ?? null,
          };
        } catch (err) {
          if (err instanceof NotFoundException) return null; // absent, not an error
          throw err;
        }
      }
      case 'spaces.list': {
        const spaces = await this.spaces.list(false);
        return spaces.map((s) => ({ id: s.id, key: s.key, name: s.name, status: s.status }));
      }
      case 'variable.get': {
        // A read — works identically in mock mode (scripts need real config to run).
        // Resolution order: this automation's scoped variable, then global.
        const name = z.string().min(1).max(100).parse(args[0]);
        const v = await this.variables.resolve(name, ctx.automationId);
        if (!v) throw new BridgeError(`Variable "${name}" is not defined.`, 'not_found');
        // Secure values are redacted from all subsequent log output for this run.
        if (v.isSecure) ctx.registerSecret(v.value);
        return v.value;
      }

      // ---- writes (intercepted in mock mode) ----
      case 'pages.create': {
        const input = createInputSchema.parse(args[0]);
        const opts = optsSchema.parse(args[1]);
        if (ctx.dryRun) {
          ctx.log({
            source: 'mock',
            state: 'info',
            message: `MOCK: would create page "${input.title}" in space ${input.spaceId}`,
            data: { method, input },
          });
          return { id: `mock-${randomUUID()}`, ...input, mocked: true };
        }
        const d = await this.inRunContext(ctx, opts?.allowTriggers ?? false, () =>
          this.pages.create(ctx.principal, input.spaceId, input, ctx.auditCtx),
        );
        return d.page;
      }
      case 'pages.update': {
        const id = idSchema.parse(args[0]);
        const data = updateDataSchema.parse(args[1]);
        const opts = optsSchema.parse(args[2]);
        // Existence check is real even in mock mode.
        const current = await this.pages.getById(ctx.principal, id, ctx.auditCtx);
        if (ctx.dryRun) {
          ctx.log({
            source: 'mock',
            state: 'info',
            message: `MOCK: would update page "${current.page.title}" (${id})`,
            data: { method, changes: data },
          });
          return { ...current.page, ...(data.title ? { title: data.title } : {}), mocked: true };
        }
        // Automations are last-write-wins: supply the current version, retry once
        // if someone slips in between.
        const doUpdate = async () => {
          const fresh = await this.pages.getById(ctx.principal, id, ctx.auditCtx);
          return this.pages.update(
            ctx.principal,
            id,
            { ...data, baseVersionNumber: fresh.version?.versionNumber ?? 1 },
            ctx.auditCtx,
          );
        };
        const d = await this.inRunContext(ctx, opts?.allowTriggers ?? false, async () => {
          try {
            return await doUpdate();
          } catch (err) {
            if (err instanceof ConflictException) return doUpdate();
            throw err;
          }
        });
        return d.page;
      }
      case 'pages.delete': {
        const id = idSchema.parse(args[0]);
        const opts = optsSchema.parse(args[1]);
        const current = await this.pages.getById(ctx.principal, id, ctx.auditCtx);
        if (ctx.dryRun) {
          ctx.log({
            source: 'mock',
            state: 'info',
            message: `MOCK: would delete page "${current.page.title}" (${id}) and its subtree`,
            data: { method },
          });
          return undefined;
        }
        await this.inRunContext(ctx, opts?.allowTriggers ?? false, () =>
          this.pages.delete(ctx.principal, id, ctx.auditCtx),
        );
        return undefined;
      }
      case 'pages.publish': {
        const id = idSchema.parse(args[0]);
        const opts = optsSchema.parse(args[1]);
        const current = await this.pages.getById(ctx.principal, id, ctx.auditCtx);
        if (ctx.dryRun) {
          ctx.log({
            source: 'mock',
            state: 'info',
            message: `MOCK: would publish page "${current.page.title}" (${id})`,
            data: { method },
          });
          return { ...current.page, status: 'published', mocked: true };
        }
        return this.inRunContext(ctx, opts?.allowTriggers ?? false, () =>
          this.pages.publish(ctx.principal, id, ctx.auditCtx),
        );
      }
      case 'pages.move': {
        const id = idSchema.parse(args[0]);
        const dto = moveDtoSchema.parse(args[1]);
        const opts = optsSchema.parse(args[2]);
        const current = await this.pages.getById(ctx.principal, id, ctx.auditCtx);
        if (ctx.dryRun) {
          ctx.log({
            source: 'mock',
            state: 'info',
            message: `MOCK: would move page "${current.page.title}" (${id})`,
            data: { method, dto },
          });
          return { ...current.page, mocked: true };
        }
        return this.inRunContext(ctx, opts?.allowTriggers ?? false, () =>
          this.pages.move(ctx.principal, id, dto, ctx.auditCtx),
        );
      }
      case 'pages.setMetadata': {
        const id = idSchema.parse(args[0]);
        const value = metadataValueSchema.parse(args[1]);
        const opts = metadataOptsSchema.parse(args[2]);
        const current = await this.pages.getById(ctx.principal, id, ctx.auditCtx);
        if (ctx.dryRun) {
          ctx.log({
            source: 'mock',
            state: 'info',
            message: `MOCK: would set metadata on page "${current.page.title}" (${id})`,
            data: { method, value, merge: opts?.merge ?? true },
          });
          return { ...current.page, mocked: true };
        }
        const d = await this.inRunContext(ctx, opts?.allowTriggers ?? false, () =>
          this.pages.setMetadata(ctx.principal, id, value, { merge: opts?.merge ?? true }, ctx.auditCtx),
        );
        return d.page;
      }

      // ---- outbound HTTP (host-mediated; fully intercepted in mock mode) ----
      case 'fetch': {
        const url = z.string().url().parse(args[0]);
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new BridgeError('Only http(s) URLs are allowed.', 'bad_request');
        }
        const opts = fetchOptsSchema.parse(args[1]);
        if (ctx.dryRun) {
          ctx.log({
            source: 'mock',
            state: 'info',
            message: `MOCK: would ${opts?.method ?? 'GET'} ${url}`,
            data: { method, url, opts },
          });
          return { status: 0, headers: {}, body: '', mocked: true };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(url, {
            method: opts?.method ?? 'GET',
            headers: opts?.headers,
            body: opts?.body,
            signal: controller.signal,
            redirect: 'follow',
          });
          const text = await res.text();
          const headers: Record<string, string> = {};
          res.headers.forEach((v, k) => (headers[k] = v));
          return {
            status: res.status,
            headers,
            body: text.length > FETCH_BODY_CAP ? text.slice(0, FETCH_BODY_CAP) : text,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new BridgeError(
            controller.signal.aborted ? `fetch timed out after ${FETCH_TIMEOUT_MS}ms` : `fetch failed: ${msg}`,
            'fetch_failed',
          );
        } finally {
          clearTimeout(timer);
        }
      }

      default:
        throw new BridgeError(`Unknown netc method "${method}"`, 'unknown_method');
    }
  }
}
