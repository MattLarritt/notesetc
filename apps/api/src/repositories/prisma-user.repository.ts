import { Injectable } from '@nestjs/common';
import type { AuthSource, GlobalRole } from '@notesetc/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreateLocalUserInput,
  type UpsertBreakglassInput,
  UserRecord,
  UserRepository,
} from './user.repository';

type PrismaUser = {
  id: string;
  email: string;
  displayName: string;
  authSource: string;
  entraOid: string | null;
  passwordHash: string | null;
  isBreakglass: boolean;
  globalRole: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

function toRecord(u: PrismaUser): UserRecord {
  return {
    ...u,
    authSource: u.authSource as AuthSource,
    globalRole: u.globalRole as GlobalRole,
    status: u.status as 'active' | 'disabled',
  };
}

@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findUnique({ where: { email } });
    return u ? toRecord(u) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findUnique({ where: { id } });
    return u ? toRecord(u) : null;
  }

  async findBreakglass(): Promise<UserRecord | null> {
    const u = await this.prisma.user.findFirst({ where: { isBreakglass: true } });
    return u ? toRecord(u) : null;
  }

  async findByIds(ids: string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.user.findMany({ where: { id: { in: ids } } });
    return rows.map(toRecord);
  }

  async list(): Promise<UserRecord[]> {
    const rows = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toRecord);
  }

  async createLocal(input: CreateLocalUserInput): Promise<UserRecord> {
    const u = await this.prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        authSource: 'local',
        globalRole: input.globalRole,
        status: 'active',
      },
    });
    return toRecord(u);
  }

  async setStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { status } });
  }

  async setGlobalRole(id: string, role: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { globalRole: role } });
  }

  async recordLogin(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } });
  }

  async upsertBreakglass(input: UpsertBreakglassInput): Promise<UserRecord> {
    const u = await this.prisma.user.upsert({
      where: { email: input.email },
      update: {
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        authSource: 'local',
        isBreakglass: true,
        globalRole: 'global_admin',
        status: 'active',
      },
      create: {
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        authSource: 'local',
        isBreakglass: true,
        globalRole: 'global_admin',
        status: 'active',
      },
    });
    return toRecord(u);
  }
}
