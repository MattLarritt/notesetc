import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type ApiTokenRecord,
  ApiTokenRepository,
  type CreateApiTokenInput,
} from './api-token.repository';

type PrismaApiToken = {
  id: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  ownerUserId: string;
  allowedSpaceIds: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

function toRecord(t: PrismaApiToken): ApiTokenRecord {
  let allowed: string[] | null = null;
  if (t.allowedSpaceIds) {
    try {
      const parsed = JSON.parse(t.allowedSpaceIds);
      if (Array.isArray(parsed)) allowed = parsed as string[];
    } catch {
      allowed = null;
    }
  }
  return {
    id: t.id,
    name: t.name,
    tokenHash: t.tokenHash,
    tokenPrefix: t.tokenPrefix,
    ownerUserId: t.ownerUserId,
    allowedSpaceIds: allowed,
    lastUsedAt: t.lastUsedAt,
    expiresAt: t.expiresAt,
    revokedAt: t.revokedAt,
    createdAt: t.createdAt,
  };
}

@Injectable()
export class PrismaApiTokenRepository extends ApiTokenRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateApiTokenInput): Promise<ApiTokenRecord> {
    const t = await this.prisma.apiToken.create({
      data: {
        name: input.name,
        tokenHash: input.tokenHash,
        tokenPrefix: input.tokenPrefix,
        ownerUserId: input.ownerUserId,
        allowedSpaceIds:
          input.allowedSpaceIds && input.allowedSpaceIds.length
            ? JSON.stringify(input.allowedSpaceIds)
            : null,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return toRecord(t);
  }

  async findByPrefix(prefix: string): Promise<ApiTokenRecord | null> {
    const t = await this.prisma.apiToken.findUnique({ where: { tokenPrefix: prefix } });
    return t ? toRecord(t) : null;
  }

  async findById(id: string): Promise<ApiTokenRecord | null> {
    const t = await this.prisma.apiToken.findUnique({ where: { id } });
    return t ? toRecord(t) : null;
  }

  async list(): Promise<ApiTokenRecord[]> {
    const rows = await this.prisma.apiToken.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toRecord);
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.prisma.apiToken.update({ where: { id }, data: { revokedAt: at } });
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    await this.prisma.apiToken.update({ where: { id }, data: { lastUsedAt: at } });
  }

  async updateSecret(id: string, tokenHash: string, tokenPrefix: string): Promise<void> {
    await this.prisma.apiToken.update({ where: { id }, data: { tokenHash, tokenPrefix } });
  }
}
