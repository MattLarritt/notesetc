import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreateSessionInput,
  type SessionRecord,
  SessionRepository,
} from './session.repository';

@Injectable()
export class PrismaSessionRepository extends SessionRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    return this.prisma.session.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.session.findUnique({ where: { tokenHash } });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { revokedAt: at } });
  }
}
