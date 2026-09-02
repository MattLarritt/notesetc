import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreateGroupInput,
  type GroupRecord,
  GroupRepository,
} from './group.repository';

type PrismaGroup = {
  id: string;
  name: string;
  source: string;
  description: string | null;
  system: boolean;
  createdAt: Date;
};

const toRecord = (g: PrismaGroup): GroupRecord => ({
  id: g.id,
  name: g.name,
  source: g.source,
  description: g.description,
  system: g.system,
  createdAt: g.createdAt,
});

@Injectable()
export class PrismaGroupRepository extends GroupRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(): Promise<GroupRecord[]> {
    const rows = await this.prisma.group.findMany({ orderBy: [{ system: 'desc' }, { name: 'asc' }] });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<GroupRecord | null> {
    const g = await this.prisma.group.findUnique({ where: { id } });
    return g ? toRecord(g) : null;
  }

  async findByName(name: string): Promise<GroupRecord | null> {
    const g = await this.prisma.group.findUnique({ where: { name } });
    return g ? toRecord(g) : null;
  }

  async create(input: CreateGroupInput): Promise<GroupRecord> {
    const g = await this.prisma.group.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        source: input.source ?? 'local',
        system: input.system ?? false,
      },
    });
    return toRecord(g);
  }

  async update(id: string, input: { name?: string; description?: string | null }): Promise<GroupRecord> {
    const g = await this.prisma.group.update({
      where: { id },
      data: { name: input.name, description: input.description },
    });
    return toRecord(g);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.group.delete({ where: { id } });
  }

  async listMemberIds(groupId: string): Promise<string[]> {
    const rows = await this.prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async memberCount(groupId: string): Promise<number> {
    return this.prisma.groupMember.count({ where: { groupId } });
  }

  async addMember(groupId: string, userId: string): Promise<void> {
    await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId },
      update: {},
    });
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.prisma.groupMember.deleteMany({ where: { groupId, userId } });
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    return Boolean(row);
  }

  async listGroupIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    return rows.map((r) => r.groupId);
  }
}
