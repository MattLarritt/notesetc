import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreateSpaceInput,
  type SpaceRecord,
  SpaceRepository,
  type UpdateSpaceInput,
} from './space.repository';

type PrismaSpace = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  overview: string | null;
  ownerId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

function toRecord(s: PrismaSpace): SpaceRecord {
  return {
    ...s,
    status: s.status as 'active' | 'archived',
    defaultTemplateId: (s as PrismaSpace & { defaultTemplateId: string | null }).defaultTemplateId ?? null,
  };
}

@Injectable()
export class PrismaSpaceRepository extends SpaceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(includeArchived: boolean): Promise<SpaceRecord[]> {
    const rows = await this.prisma.space.findMany({
      where: includeArchived ? {} : { status: 'active' },
      orderBy: { key: 'asc' },
    });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<SpaceRecord | null> {
    const s = await this.prisma.space.findUnique({ where: { id } });
    return s ? toRecord(s) : null;
  }

  async findByKey(key: string): Promise<SpaceRecord | null> {
    const s = await this.prisma.space.findUnique({ where: { key } });
    return s ? toRecord(s) : null;
  }

  async create(input: CreateSpaceInput): Promise<SpaceRecord> {
    const s = await this.prisma.space.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? null,
        ownerId: input.ownerId ?? null,
        status: 'active',
      },
    });
    return toRecord(s);
  }

  async update(id: string, input: UpdateSpaceInput): Promise<SpaceRecord> {
    const s = await this.prisma.space.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        icon: input.icon,
        overview: input.overview,
        defaultTemplateId: input.defaultTemplateId,
      },
    });
    return toRecord(s);
  }

  async archive(id: string, at: Date): Promise<SpaceRecord> {
    const s = await this.prisma.space.update({
      where: { id },
      data: { status: 'archived', archivedAt: at },
    });
    return toRecord(s);
  }

  async unarchive(id: string): Promise<SpaceRecord> {
    const s = await this.prisma.space.update({
      where: { id },
      data: { status: 'active', archivedAt: null },
    });
    return toRecord(s);
  }
}
