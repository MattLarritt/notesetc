import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreateTemplateInput,
  type TemplateRecord,
  TemplateRepository,
} from './template.repository';

type PrismaTemplate = {
  id: string;
  spaceId: string;
  name: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

const toRecord = (t: PrismaTemplate): TemplateRecord => ({
  id: t.id,
  spaceId: t.spaceId,
  name: t.name,
  content: t.content,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

@Injectable()
export class PrismaTemplateRepository extends TemplateRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listBySpace(spaceId: string): Promise<TemplateRecord[]> {
    const rows = await this.prisma.template.findMany({
      where: { spaceId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<TemplateRecord | null> {
    const t = await this.prisma.template.findUnique({ where: { id } });
    return t ? toRecord(t) : null;
  }

  async create(input: CreateTemplateInput): Promise<TemplateRecord> {
    const t = await this.prisma.template.create({
      data: {
        spaceId: input.spaceId,
        name: input.name,
        content: input.content ?? '',
        createdById: input.createdById ?? null,
      },
    });
    return toRecord(t);
  }

  async update(id: string, input: { name?: string; content?: string }): Promise<TemplateRecord> {
    const t = await this.prisma.template.update({
      where: { id },
      data: { name: input.name, content: input.content },
    });
    return toRecord(t);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.template.delete({ where: { id } });
  }
}
