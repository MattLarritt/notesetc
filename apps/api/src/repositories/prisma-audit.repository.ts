import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AuditEntry,
  type AuditQuery,
  type AuditRecord,
  AuditRepository,
} from './audit.repository';

@Injectable()
export class PrismaAuditRepository extends AuditRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async append(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorUserId: entry.actorUserId ?? null,
        actorTokenId: entry.actorTokenId ?? null,
        aiAgentLabel: entry.aiAgentLabel ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        spaceId: entry.spaceId ?? null,
        result: entry.result,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        requestId: entry.requestId ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  }

  async query(filter: AuditQuery): Promise<AuditRecord[]> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: filter.action || undefined,
        actorType: filter.actorType || undefined,
        result: filter.result || undefined,
        spaceId: filter.spaceId || undefined,
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      actorType: r.actorType,
      actorUserId: r.actorUserId,
      actorTokenId: r.actorTokenId,
      aiAgentLabel: r.aiAgentLabel,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      spaceId: r.spaceId,
      result: r.result,
      ip: r.ip,
      requestId: r.requestId,
      metadata: r.metadata,
    }));
  }
}
