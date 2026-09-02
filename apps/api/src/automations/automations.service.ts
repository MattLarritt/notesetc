import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Action,
  AuditResult,
  AutomationTriggerType,
  type Principal,
} from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { ConfigService } from '../config/config.service';
import { encryptVariable } from './execution/variable-crypto';
import {
  type AutomationRecord,
  AutomationRepository,
  type AutomationRunLogRecord,
  type AutomationRunRecord,
  GLOBAL_VARIABLE_SCOPE,
} from '../repositories/automation.repository';
import { slugify } from '../common/slug';
import { ExecutionManagerService } from './execution/execution-manager.service';
import type { TriggerInfo } from './execution/protocol';
import { AutomationSchedulerService } from './triggers/automation-scheduler.service';
import {
  type CreateAutomationDto,
  type TestAutomationDto,
  type UpdateAutomationDto,
  validateTriggerConfig,
} from './dto';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Admin CRUD + run management for automations. Global-admin only
 * (Action.AdminAutomations). Every mutation is audited; the scheduler is
 * resynced whenever a schedule automation changes.
 */
@Injectable()
export class AutomationsService {
  constructor(
    private readonly repo: AutomationRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly executions: ExecutionManagerService,
    @Inject(forwardRef(() => AutomationSchedulerService))
    private readonly scheduler: AutomationSchedulerService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------------ CRUD

  async list(principal: Principal, ctx: AuditContext): Promise<AutomationRecord[]> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    return this.repo.list();
  }

  async get(principal: Principal, id: string, ctx: AuditContext): Promise<AutomationRecord> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    return this.require(id);
  }

  async create(
    principal: Principal,
    dto: CreateAutomationDto,
    ctx: AuditContext,
  ): Promise<{ automation: AutomationRecord; webhookSecret?: string }> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);

    const triggerConfig = this.parseTriggerConfig(dto.triggerType, dto.triggerConfig);
    this.validateCron(dto.triggerType, triggerConfig);

    let webhookSlug: string | null = null;
    let webhookSecret: string | undefined;
    let webhookSecretHash: string | null = null;
    if (dto.triggerType === AutomationTriggerType.Webhook) {
      webhookSlug = dto.webhookSlug ?? slugify(dto.name);
      webhookSecret = randomBytes(32).toString('base64url');
      webhookSecretHash = sha256(webhookSecret);
    }

    const automation = await this.uniqueNameGuard(() =>
      this.repo.create({
        name: dto.name,
        description: dto.description ?? null,
        enabled: dto.enabled,
        triggerType: dto.triggerType,
        triggerConfig,
        script: dto.script,
        timeoutMs: dto.timeoutMs,
        debugMode: dto.debugMode,
        webhookSlug,
        webhookSecretHash,
        createdById: principal.userId,
      }),
    );

    await this.auditWrite(principal, automation, ctx, { created: true, triggerType: dto.triggerType });
    await this.scheduler.resync(automation);
    return { automation, webhookSecret };
  }

  async update(
    principal: Principal,
    id: string,
    dto: UpdateAutomationDto,
    ctx: AuditContext,
  ): Promise<AutomationRecord> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    const existing = await this.require(id);

    let triggerConfig: Record<string, unknown> | undefined;
    if (dto.triggerConfig !== undefined) {
      triggerConfig = this.parseTriggerConfig(existing.triggerType, dto.triggerConfig);
      this.validateCron(existing.triggerType, triggerConfig);
    }
    if (dto.webhookSlug !== undefined && existing.triggerType !== AutomationTriggerType.Webhook) {
      throw new BadRequestException('webhookSlug applies only to webhook automations.');
    }

    const updated = await this.uniqueNameGuard(() =>
      this.repo.update(id, {
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled,
        triggerConfig,
        script: dto.script,
        timeoutMs: dto.timeoutMs,
        debugMode: dto.debugMode,
        webhookSlug: dto.webhookSlug,
        updatedById: principal.userId,
      }),
    );

    await this.auditWrite(principal, updated, ctx, {
      updated: Object.keys(dto),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
    });
    await this.scheduler.resync(updated);
    return updated;
  }

  async delete(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    const existing = await this.require(id);
    await this.repo.delete(id);
    await this.repo.deleteVariablesForScope(id); // scoped variables die with the script
    await this.auditWrite(principal, existing, ctx, { deleted: true });
    await this.scheduler.remove(id);
  }

  /** Map the unique-name constraint violation to a friendly 409. */
  private async uniqueNameGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; meta?: { target?: string[] } };
      if (e.code === 'P2002' && e.meta?.target?.includes('name')) {
        throw new ConflictException('An automation with this name already exists.');
      }
      throw err;
    }
  }

  async rotateWebhookSecret(
    principal: Principal,
    id: string,
    ctx: AuditContext,
  ): Promise<{ webhookSecret: string }> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    const existing = await this.require(id);
    if (existing.triggerType !== AutomationTriggerType.Webhook) {
      throw new BadRequestException('Only webhook automations have a secret.');
    }
    const secret = randomBytes(32).toString('base64url');
    await this.repo.update(id, { webhookSecretHash: sha256(secret), updatedById: principal.userId });
    await this.auditWrite(principal, existing, ctx, { rotatedSecret: true });
    return { webhookSecret: secret };
  }

  // ------------------------------------------------------------------ runs

  async testRun(
    principal: Principal,
    id: string,
    dto: TestAutomationDto,
    ctx: AuditContext,
  ): Promise<{ runId: string }> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    const automation = await this.require(id);

    const trigger: TriggerInfo = {
      type: 'manual',
      firedAt: new Date().toISOString(),
      actor: { type: principal.actorType, userId: principal.userId },
      ...(dto.simulatedEvent ?? {}),
    } as TriggerInfo;

    const runId = await this.executions.enqueue({
      automation,
      trigger: 'test',
      triggerInfo: trigger,
      dryRun: dto.mockMode,
      depth: 0,
    });
    await this.audit.record(
      principal,
      {
        action: Action.AdminAutomations,
        result: AuditResult.Success,
        targetType: 'automation',
        targetId: id,
        metadata: { testRun: runId, mockMode: dto.mockMode },
      },
      ctx,
    );
    return { runId };
  }

  async listRuns(
    principal: Principal,
    ctx: AuditContext,
    filter: { automationId?: string; status?: string; limit?: number },
  ): Promise<AutomationRunRecord[]> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    return this.repo.listRuns({
      automationId: filter.automationId,
      status: filter.status as AutomationRunRecord['status'] | undefined,
      limit: filter.limit,
    });
  }

  async getRun(
    principal: Principal,
    runId: string,
    ctx: AuditContext,
    afterSeq?: number,
  ): Promise<{ run: AutomationRunRecord; logs: AutomationRunLogRecord[] }> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    const run = await this.repo.findRun(runId);
    if (!run) throw new NotFoundException('Run not found.');
    const logs = await this.repo.listLogs(runId, afterSeq);
    return { run, logs };
  }

  async stopRun(principal: Principal, runId: string, ctx: AuditContext): Promise<{ stopped: boolean }> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    const run = await this.repo.findRun(runId);
    if (!run) throw new NotFoundException('Run not found.');
    const stopped = await this.executions.forceStop(runId);
    await this.audit.record(
      principal,
      {
        action: Action.AdminAutomations,
        result: AuditResult.Success,
        targetType: 'automation_run',
        targetId: runId,
        metadata: { forceStop: true, stopped },
      },
      ctx,
    );
    return { stopped };
  }

  // ---------------------------------------------------------------- helpers

  private async require(id: string): Promise<AutomationRecord> {
    const a = await this.repo.findById(id);
    if (!a) throw new NotFoundException('Automation not found.');
    return a;
  }

  private parseTriggerConfig(triggerType: string, config: unknown): Record<string, unknown> {
    try {
      return validateTriggerConfig(triggerType, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Invalid trigger config: ${msg}`);
    }
  }

  private validateCron(triggerType: string, config: Record<string, unknown>): void {
    if (triggerType !== AutomationTriggerType.Schedule) return;
    const error = this.scheduler.validateCronExpression(String(config.cron ?? ''));
    if (error) throw new BadRequestException(`Invalid cron expression: ${error}`);
  }

  private async auditWrite(
    principal: Principal,
    automation: AutomationRecord,
    ctx: AuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      principal,
      {
        action: Action.AdminAutomations,
        result: AuditResult.Success,
        targetType: 'automation',
        targetId: automation.id,
        metadata: { name: automation.name, ...metadata },
      },
      ctx,
    );
  }

  // ------------------------------------------------------------- variables

  /** Validate a variable scope: 'global' or an existing automation id. */
  private async requireScope(scope: string): Promise<string> {
    if (scope === GLOBAL_VARIABLE_SCOPE) return scope;
    await this.require(scope); // throws NotFound if the automation doesn't exist
    return scope;
  }

  /** List variables in a scope. Secure values are NEVER returned — masked to null. */
  async listVariables(
    principal: Principal,
    ctx: AuditContext,
    scope: string = GLOBAL_VARIABLE_SCOPE,
  ): Promise<Array<{ scope: string; name: string; isSecure: boolean; value: string | null; updatedAt: Date }>> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    const vars = await this.repo.listVariables(scope);
    return vars.map((v) => ({
      scope: v.scope,
      name: v.name,
      isSecure: v.isSecure,
      value: v.isSecure ? null : v.value,
      updatedAt: v.updatedAt,
    }));
  }

  async setVariable(
    principal: Principal,
    scope: string,
    name: string,
    value: string,
    isSecure: boolean,
    ctx: AuditContext,
  ): Promise<{ scope: string; name: string; isSecure: boolean }> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    await this.requireScope(scope);
    let stored = value;
    if (isSecure) {
      const masterKey = this.config.get('MASTER_ENCRYPTION_KEY');
      if (!masterKey) {
        throw new BadRequestException(
          'Secure variables require MASTER_ENCRYPTION_KEY to be configured.',
        );
      }
      stored = encryptVariable(value, masterKey);
    }
    await this.repo.upsertVariable({ scope, name, value: stored, isSecure, userId: principal.userId });
    // Audit the ACT, never the value.
    await this.audit.record(
      principal,
      {
        action: Action.AdminAutomations,
        result: AuditResult.Success,
        targetType: 'automation_variable',
        targetId: `${scope}:${name}`,
        metadata: { set: true, isSecure, scope },
      },
      ctx,
    );
    return { scope, name, isSecure };
  }

  async deleteVariable(
    principal: Principal,
    scope: string,
    name: string,
    ctx: AuditContext,
  ): Promise<void> {
    await this.authz.authorize(principal, Action.AdminAutomations, { type: 'global' }, ctx);
    const existing = await this.repo.findVariable(scope, name);
    if (!existing) throw new NotFoundException('Variable not found.');
    await this.repo.deleteVariable(scope, name);
    await this.audit.record(
      principal,
      {
        action: Action.AdminAutomations,
        result: AuditResult.Success,
        targetType: 'automation_variable',
        targetId: `${scope}:${name}`,
        metadata: { deleted: true, scope },
      },
      ctx,
    );
  }

  // ------------------------------------------------- webhook (public path)

  /**
   * Resolve + authenticate a webhook call. Returns null (caller responds 404)
   * for unknown slug, disabled automation, or bad secret — indistinguishable
   * on purpose (no slug enumeration).
   */
  async resolveWebhook(slug: string, providedSecret: string | undefined): Promise<AutomationRecord | null> {
    if (!providedSecret) return null;
    const automation = await this.repo.findByWebhookSlug(slug);
    if (!automation || !automation.enabled) return null;
    const storedHash = await this.repo.getWebhookSecretHash(automation.id);
    if (!storedHash) return null;
    const provided = Buffer.from(sha256(providedSecret), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) return null;
    return automation;
  }

  /** Fire a webhook-triggered run (already authenticated). */
  async fireWebhook(
    automation: AutomationRecord,
    webhook: { method: string; headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<{ runId: string }> {
    const runId = await this.executions.enqueue({
      automation,
      trigger: 'webhook',
      triggerInfo: { type: 'webhook', webhook, firedAt: new Date().toISOString() },
      dryRun: false,
      depth: 0,
    });
    return { runId };
  }
}
