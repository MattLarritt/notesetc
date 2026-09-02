import { Injectable } from '@nestjs/common';
import { type ResolvedGrant, type ResourceRole, SYSTEM_GROUP } from '@notesetc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { type CreateGrantInput, type GrantRecord, GrantRepository } from './grant.repository';

type PrismaGrant = {
  id: string;
  resourceType: string;
  resourceId: string;
  principalType: string;
  principalId: string;
  role: string;
  grantedById: string | null;
  createdAt: Date;
};

function toRecord(g: PrismaGrant): GrantRecord {
  return {
    ...g,
    resourceType: g.resourceType as 'space' | 'page',
    principalType: g.principalType as 'user' | 'group',
    role: g.role as ResourceRole,
  };
}

@Injectable()
export class PrismaGrantRepository extends GrantRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listForResource(
    resourceType: 'space' | 'page',
    resourceId: string,
  ): Promise<GrantRecord[]> {
    const rows = await this.prisma.resourceGrant.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async create(input: CreateGrantInput): Promise<GrantRecord> {
    const g = await this.prisma.resourceGrant.create({
      data: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        principalType: input.principalType,
        principalId: input.principalId,
        role: input.role,
        grantedById: input.grantedById ?? null,
      },
    });
    return toRecord(g);
  }

  async findById(id: string): Promise<GrantRecord | null> {
    const g = await this.prisma.resourceGrant.findUnique({ where: { id } });
    return g ? toRecord(g) : null;
  }

  async updateRole(id: string, role: ResourceRole): Promise<GrantRecord> {
    const g = await this.prisma.resourceGrant.update({ where: { id }, data: { role } });
    return toRecord(g);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.resourceGrant.delete({ where: { id } });
  }

  async deleteForPrincipal(principalType: 'user' | 'group', principalId: string): Promise<void> {
    await this.prisma.resourceGrant.deleteMany({ where: { principalType, principalId } });
  }

  async resolveForUser(userId: string): Promise<ResolvedGrant[]> {
    const memberGroupIds = (
      await this.prisma.groupMember.findMany({
        where: { userId },
        select: { groupId: true },
      })
    ).map((m) => m.groupId);

    // "All Users" and "Public" are implicit — everyone signed in belongs to both,
    // so their grants always apply to an authenticated caller too.
    const implicit = await this.prisma.group.findMany({
      where: { system: true, name: { in: [SYSTEM_GROUP.AllUsers, SYSTEM_GROUP.Public] } },
      select: { id: true },
    });
    const groupIds = [...memberGroupIds, ...implicit.map((g) => g.id)];

    const rows = await this.prisma.resourceGrant.findMany({
      where: {
        OR: [
          { principalType: 'user', principalId: userId },
          ...(groupIds.length ? [{ principalType: 'group', principalId: { in: groupIds } }] : []),
        ],
      },
      select: { resourceType: true, resourceId: true, role: true },
    });

    return rows.map((r) => ({
      resourceType: r.resourceType as 'space' | 'page',
      resourceId: r.resourceId,
      role: r.role as ResourceRole,
    }));
  }

  async resolveForAnonymous(): Promise<ResolvedGrant[]> {
    const publicGroup = await this.prisma.group.findFirst({
      where: { name: SYSTEM_GROUP.Public, system: true },
      select: { id: true },
    });
    if (!publicGroup) return [];
    const rows = await this.prisma.resourceGrant.findMany({
      where: { principalType: 'group', principalId: publicGroup.id },
      select: { resourceType: true, resourceId: true, role: true },
    });
    return rows.map((r) => ({
      resourceType: r.resourceType as 'space' | 'page',
      resourceId: r.resourceId,
      role: r.role as ResourceRole,
    }));
  }
}
