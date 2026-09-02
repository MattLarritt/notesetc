import { Injectable } from '@nestjs/common';
import type { AutomationRunStatus, AutomationTriggerType } from '@notesetc/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AutomationRecord,
  AutomationRepository,
  type AutomationRunLogRecord,
  type AutomationRunRecord,
  type AutomationVariableRecord,
  type CreateAutomationInput,
  type LogEntryInput,
  type RunListFilter,
  type UpdateAutomationInput,
} from './automation.repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* corrupt -> empty */
    }
  }
  return {};
}

function toAutomation(a: any): AutomationRecord {
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? null,
    enabled: a.enabled,
    triggerType: a.triggerType as AutomationTriggerType,
    triggerConfig: parseJson(a.triggerConfig),
    script: a.script,
    timeoutMs: a.timeoutMs,
    debugMode: a.debugMode,
    webhookSlug: a.webhookSlug ?? null,
    hasWebhookSecret: !!a.webhookSecretHash,
    createdById: a.createdById ?? null,
    updatedById: a.updatedById ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function toRun(r: any): AutomationRunRecord {
  return {
    id: r.id,
    automationId: r.automationId,
    status: r.status as AutomationRunStatus,
    trigger: r.trigger,
    triggerPayload: r.triggerPayload ? parseJson(r.triggerPayload) : null,
    dryRun: r.dryRun,
    debug: r.debug,
    error: r.error ?? null,
    startedAt: r.startedAt ?? null,
    finishedAt: r.finishedAt ?? null,
    createdAt: r.createdAt,
  };
}

function toLog(l: any): AutomationRunLogRecord {
  let data: unknown = null;
  if (typeof l.data === 'string' && l.data.length > 0) {
    try {
      data = JSON.parse(l.data);
    } catch {
      data = l.data;
    }
  }
  return { seq: l.seq, ts: l.ts, source: l.source, state: l.state, message: l.message, data };
}

@Injectable()
export class PrismaAutomationRepository extends AutomationRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateAutomationInput): Promise<AutomationRecord> {
    const a = await this.prisma.automation.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        enabled: input.enabled,
        triggerType: input.triggerType,
        triggerConfig: JSON.stringify(input.triggerConfig ?? {}),
        script: input.script,
        timeoutMs: input.timeoutMs,
        debugMode: input.debugMode,
        webhookSlug: input.webhookSlug ?? null,
        webhookSecretHash: input.webhookSecretHash ?? null,
        createdById: input.createdById,
        updatedById: input.createdById,
      },
    });
    return toAutomation(a);
  }

  async update(id: string, input: UpdateAutomationInput): Promise<AutomationRecord> {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.triggerConfig !== undefined) data.triggerConfig = JSON.stringify(input.triggerConfig);
    if (input.script !== undefined) data.script = input.script;
    if (input.timeoutMs !== undefined) data.timeoutMs = input.timeoutMs;
    if (input.debugMode !== undefined) data.debugMode = input.debugMode;
    if (input.webhookSlug !== undefined) data.webhookSlug = input.webhookSlug;
    if (input.webhookSecretHash !== undefined) data.webhookSecretHash = input.webhookSecretHash;
    if (input.updatedById !== undefined) data.updatedById = input.updatedById;
    const a = await this.prisma.automation.update({ where: { id }, data });
    return toAutomation(a);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.automation.delete({ where: { id } });
  }

  async findById(id: string): Promise<AutomationRecord | null> {
    const a = await this.prisma.automation.findUnique({ where: { id } });
    return a ? toAutomation(a) : null;
  }

  async findByWebhookSlug(slug: string): Promise<AutomationRecord | null> {
    const a = await this.prisma.automation.findUnique({ where: { webhookSlug: slug } });
    return a ? toAutomation(a) : null;
  }

  async getWebhookSecretHash(id: string): Promise<string | null> {
    const a = await this.prisma.automation.findUnique({
      where: { id },
      select: { webhookSecretHash: true },
    });
    return a?.webhookSecretHash ?? null;
  }

  async list(): Promise<AutomationRecord[]> {
    const rows = await this.prisma.automation.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toAutomation);
  }

  async listEnabledByTrigger(triggerType: AutomationTriggerType): Promise<AutomationRecord[]> {
    const rows = await this.prisma.automation.findMany({
      where: { enabled: true, triggerType },
      orderBy: { name: 'asc' },
    });
    return rows.map(toAutomation);
  }

  // --- runs ---

  async createRun(input: {
    automationId: string;
    trigger: string;
    triggerPayload?: Record<string, unknown> | null;
    dryRun: boolean;
    debug: boolean;
  }): Promise<AutomationRunRecord> {
    const payload = input.triggerPayload ? JSON.stringify(input.triggerPayload) : null;
    const r = await this.prisma.automationRun.create({
      data: {
        automationId: input.automationId,
        trigger: input.trigger,
        // Cap the snapshot so a huge webhook body can't bloat the table.
        triggerPayload: payload && payload.length > 64_000 ? payload.slice(0, 64_000) : payload,
        dryRun: input.dryRun,
        debug: input.debug,
      },
    });
    return toRun(r);
  }

  async markRunStarted(runId: string): Promise<void> {
    await this.prisma.automationRun.update({
      where: { id: runId },
      data: { status: 'running', startedAt: new Date() },
    });
  }

  async finishRun(runId: string, status: AutomationRunStatus, error?: string | null): Promise<void> {
    await this.prisma.automationRun.update({
      where: { id: runId },
      data: { status, error: error ?? null, finishedAt: new Date() },
    });
  }

  async findRun(runId: string): Promise<AutomationRunRecord | null> {
    const r = await this.prisma.automationRun.findUnique({ where: { id: runId } });
    return r ? toRun(r) : null;
  }

  async listRuns(filter: RunListFilter): Promise<AutomationRunRecord[]> {
    const rows = await this.prisma.automationRun.findMany({
      where: {
        ...(filter.automationId ? { automationId: filter.automationId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
    return rows.map(toRun);
  }

  async hasActiveRun(automationId: string): Promise<boolean> {
    const n = await this.prisma.automationRun.count({
      where: { automationId, status: { in: ['queued', 'running'] } },
    });
    return n > 0;
  }

  async markStaleRunsDead(reason: string, runIds?: string[]): Promise<number> {
    const res = await this.prisma.automationRun.updateMany({
      where: {
        status: { in: ['queued', 'running'] },
        ...(runIds ? { id: { in: runIds } } : {}),
      },
      data: { status: 'dead', error: reason, finishedAt: new Date() },
    });
    return res.count;
  }

  async pruneRunsOlderThan(cutoff: Date): Promise<number> {
    const res = await this.prisma.automationRun.deleteMany({
      where: { createdAt: { lt: cutoff }, status: { notIn: ['queued', 'running'] } },
    });
    return res.count;
  }

  // --- logs ---

  async appendLogs(runId: string, entries: LogEntryInput[]): Promise<void> {
    if (!entries.length) return;
    await this.prisma.automationRunLog.createMany({
      data: entries.map((e) => ({
        runId,
        seq: e.seq,
        ts: e.ts,
        source: e.source,
        state: e.state,
        message: e.message,
        data: e.data === undefined || e.data === null ? null : JSON.stringify(e.data),
      })),
      skipDuplicates: true, // seq collision on retry must not fail the flush
    });
  }

  async listLogs(runId: string, afterSeq?: number): Promise<AutomationRunLogRecord[]> {
    const rows = await this.prisma.automationRunLog.findMany({
      where: { runId, ...(afterSeq !== undefined ? { seq: { gt: afterSeq } } : {}) },
      orderBy: { seq: 'asc' },
      take: 2000,
    });
    return rows.map(toLog);
  }

  // --- variables ---

  async listVariables(scope: string): Promise<AutomationVariableRecord[]> {
    return this.prisma.automationVariable.findMany({ where: { scope }, orderBy: { name: 'asc' } });
  }

  async findVariable(scope: string, name: string): Promise<AutomationVariableRecord | null> {
    return this.prisma.automationVariable.findUnique({
      where: { scope_name: { scope, name } },
    });
  }

  async upsertVariable(input: {
    scope: string;
    name: string;
    value: string;
    isSecure: boolean;
    userId: string | null;
  }): Promise<AutomationVariableRecord> {
    return this.prisma.automationVariable.upsert({
      where: { scope_name: { scope: input.scope, name: input.name } },
      create: {
        scope: input.scope,
        name: input.name,
        value: input.value,
        isSecure: input.isSecure,
        createdById: input.userId,
        updatedById: input.userId,
      },
      update: { value: input.value, isSecure: input.isSecure, updatedById: input.userId },
    });
  }

  async deleteVariable(scope: string, name: string): Promise<void> {
    await this.prisma.automationVariable.delete({
      where: { scope_name: { scope, name } },
    });
  }

  async deleteVariablesForScope(scope: string): Promise<void> {
    await this.prisma.automationVariable.deleteMany({ where: { scope } });
  }
}
