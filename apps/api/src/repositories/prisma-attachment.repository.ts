import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AttachmentRecord,
  AttachmentRepository,
  type CreateAttachmentInput,
} from './attachment.repository';

type PrismaAttachment = {
  id: string;
  spaceId: string;
  pageId: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  checksumSha256: string;
  scanStatus: string;
  uploadedById: string | null;
  authorType: string;
  createdAt: Date;
};

function toRecord(a: PrismaAttachment): AttachmentRecord {
  return { ...a, scanStatus: a.scanStatus as AttachmentRecord['scanStatus'] };
}

@Injectable()
export class PrismaAttachmentRepository extends AttachmentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateAttachmentInput): Promise<AttachmentRecord> {
    const a = await this.prisma.attachment.create({
      data: {
        spaceId: input.spaceId,
        pageId: input.pageId ?? null,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        checksumSha256: input.checksumSha256,
        scanStatus: input.scanStatus ?? 'clean',
        uploadedById: input.uploadedById ?? null,
        authorType: input.authorType,
      },
    });
    return toRecord(a);
  }

  async findById(id: string): Promise<AttachmentRecord | null> {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    return a ? toRecord(a) : null;
  }

  async list(spaceId: string, pageId?: string): Promise<AttachmentRecord[]> {
    const rows = await this.prisma.attachment.findMany({
      where: { spaceId, ...(pageId ? { pageId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async setPageId(id: string, pageId: string | null): Promise<void> {
    await this.prisma.attachment.update({ where: { id }, data: { pageId } });
  }
}
