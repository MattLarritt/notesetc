import { Injectable } from '@nestjs/common';
import type { ActorType, PageStatus } from '@notesetc/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreatePageInput,
  type PageRecord,
  PageRepository,
  type PageVersionRecord,
  type RevisionInput,
} from './page.repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Parse the stored metadata string into a plain object; tolerate null/garbage. */
function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* corrupt metadata -> treat as empty */
    }
  }
  return {};
}

function toPage(p: any): PageRecord {
  return {
    id: p.id,
    spaceId: p.spaceId,
    parentId: p.parentId,
    slug: p.slug,
    shortId: p.shortId ?? null,
    title: p.title,
    icon: p.icon,
    status: p.status as PageStatus,
    ownerId: p.ownerId,
    currentVersionId: p.currentVersionId,
    position: p.position,
    createdById: p.createdById,
    updatedById: p.updatedById,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    archivedAt: p.archivedAt,
    reviewIntervalDays: p.reviewIntervalDays ?? null,
    reviewDueAt: p.reviewDueAt ?? null,
    lastReviewedAt: p.lastReviewedAt ?? null,
    lastReviewedById: p.lastReviewedById ?? null,
    childTemplateId: p.childTemplateId ?? null,
    metadata: parseMetadata(p.metadata),
  };
}

function toVersion(v: any): PageVersionRecord {
  return {
    id: v.id,
    pageId: v.pageId,
    versionNumber: v.versionNumber,
    title: v.title,
    content: v.content,
    contentFormat: v.contentFormat,
    changeSummary: v.changeSummary,
    authorType: v.authorType as ActorType,
    authorUserId: v.authorUserId,
    authorTokenId: v.authorTokenId,
    aiAgentLabel: v.aiAgentLabel,
    createdAt: v.createdAt,
  };
}

@Injectable()
export class PrismaPageRepository extends PageRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreatePageInput): Promise<{ page: PageRecord; version: PageVersionRecord }> {
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.page.create({
        data: {
          spaceId: input.spaceId,
          parentId: input.parentId,
          slug: input.slug,
          shortId: input.shortId,
          title: input.title,
          icon: input.icon ?? null,
          status: 'draft',
          ownerId: input.ownerId,
          position: input.position,
          createdById: input.createdById,
          updatedById: input.createdById,
        },
      });
      const version = await tx.pageVersion.create({
        data: {
          pageId: page.id,
          versionNumber: 1,
          title: input.title,
          content: input.content,
          contentFormat: input.contentFormat,
          changeSummary: input.changeSummary ?? null,
          authorType: input.author.authorType,
          authorUserId: input.author.authorUserId ?? null,
          authorTokenId: input.author.authorTokenId ?? null,
          aiAgentLabel: input.author.aiAgentLabel ?? null,
        },
      });
      const linked = await tx.page.update({
        where: { id: page.id },
        data: { currentVersionId: version.id },
      });
      return { page: toPage(linked), version: toVersion(version) };
    });
  }

  async addRevision(
    pageId: string,
    input: RevisionInput,
  ): Promise<{ page: PageRecord; version: PageVersionRecord }> {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.pageVersion.findFirst({
        where: { pageId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const nextNumber = (last?.versionNumber ?? 0) + 1;

      const version = await tx.pageVersion.create({
        data: {
          pageId,
          versionNumber: nextNumber,
          title: input.title,
          content: input.content,
          contentFormat: input.contentFormat,
          changeSummary: input.changeSummary ?? null,
          authorType: input.author.authorType,
          authorUserId: input.author.authorUserId ?? null,
          authorTokenId: input.author.authorTokenId ?? null,
          aiAgentLabel: input.author.aiAgentLabel ?? null,
        },
      });
      const page = await tx.page.update({
        where: { id: pageId },
        data: {
          title: input.title,
          currentVersionId: version.id,
          updatedById: input.updatedById,
          // Only touch icon when provided (undefined = leave unchanged).
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
        },
      });
      return { page: toPage(page), version: toVersion(version) };
    });
  }

  async setStatus(pageId: string, status: PageStatus, updatedById: string): Promise<PageRecord> {
    const page = await this.prisma.page.update({
      where: { id: pageId },
      data: {
        status,
        updatedById,
        archivedAt: status === 'archived' ? new Date() : null,
      },
    });
    return toPage(page);
  }

  async move(
    pageId: string,
    newParentId: string | null,
    newIndex: number,
    newSpaceId?: string,
  ): Promise<PageRecord> {
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUniqueOrThrow({ where: { id: pageId } });
      const targetSpaceId = newSpaceId ?? page.spaceId;
      const crossSpace = targetSpaceId !== page.spaceId;

      // Target siblings (target space + parent), excluding the moving page, in order.
      const siblings = await tx.page.findMany({
        where: { spaceId: targetSpaceId, parentId: newParentId, id: { not: pageId } },
        orderBy: [{ position: 'asc' }, { title: 'asc' }],
        select: { id: true },
      });
      const order = siblings.map((s) => s.id);
      const clamped = Math.max(0, Math.min(newIndex, order.length));
      order.splice(clamped, 0, pageId);

      // On a cross-space move the slug must be unique within (targetSpace, newParent).
      let slug = page.slug;
      if (crossSpace) {
        let candidate = page.slug;
        let n = 2;
        while (
          await tx.page.findFirst({
            where: { spaceId: targetSpaceId, parentId: newParentId, slug: candidate, id: { not: pageId } },
            select: { id: true },
          })
        ) {
          candidate = `${page.slug}-${n++}`;
        }
        slug = candidate;
      }

      for (let i = 0; i < order.length; i++) {
        await tx.page.update({
          where: { id: order[i] },
          data:
            order[i] === pageId
              ? { position: i, parentId: newParentId, spaceId: targetSpaceId, slug }
              : { position: i },
        });
      }

      // Re-home the entire subtree to the new space (parents within the subtree are
      // unchanged, so their slugs stay unique — only the moved root could collide).
      if (crossSpace) {
        const descendants: string[] = [];
        let frontier = [pageId];
        while (frontier.length) {
          const kids = await tx.page.findMany({
            where: { parentId: { in: frontier } },
            select: { id: true },
          });
          const ids = kids.map((k) => k.id);
          descendants.push(...ids);
          frontier = ids;
        }
        if (descendants.length) {
          await tx.page.updateMany({ where: { id: { in: descendants } }, data: { spaceId: targetSpaceId } });
        }
      }
      return toPage(await tx.page.findUniqueOrThrow({ where: { id: pageId } }));
    });
  }

  async sortSiblings(spaceId: string, parentId: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const kids = await tx.page.findMany({
        where: { spaceId, parentId },
        select: { id: true, title: true },
      });
      kids.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
      for (let i = 0; i < kids.length; i++) {
        await tx.page.update({ where: { id: kids[i].id }, data: { position: i } });
      }
    });
  }

  async rename(pageId: string, title: string): Promise<PageRecord> {
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.page.update({ where: { id: pageId }, data: { title } });
      // Keep the current version's title in sync so history reflects the live name.
      if (page.currentVersionId) {
        await tx.pageVersion.update({ where: { id: page.currentVersionId }, data: { title } });
      }
      return toPage(page);
    });
  }

  async delete(pageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Detach the current-version pointer first — its FK is NoAction, so it
      // would otherwise block deleting the versions it points at.
      await tx.page.update({ where: { id: pageId }, data: { currentVersionId: null } });
      // Attachments are space-scoped; keep them but drop the page back-link.
      await tx.attachment.updateMany({ where: { pageId }, data: { pageId: null } });
      await tx.pageTag.deleteMany({ where: { pageId } });
      await tx.pageProposal.deleteMany({ where: { pageId } });
      await tx.pageMaintainer.deleteMany({ where: { pageId } });
      await tx.comment.deleteMany({ where: { pageId } });
      await tx.pageVersion.deleteMany({ where: { pageId } });
      await tx.page.delete({ where: { id: pageId } });
    });
  }

  async setReview(
    pageId: string,
    input: { reviewIntervalDays: number | null; reviewDueAt: Date | null },
  ): Promise<PageRecord> {
    const p = await this.prisma.page.update({
      where: { id: pageId },
      data: { reviewIntervalDays: input.reviewIntervalDays, reviewDueAt: input.reviewDueAt },
    });
    return toPage(p);
  }

  async markReviewed(
    pageId: string,
    input: { lastReviewedAt: Date; lastReviewedById: string; reviewDueAt: Date | null },
  ): Promise<PageRecord> {
    const p = await this.prisma.page.update({
      where: { id: pageId },
      data: {
        lastReviewedAt: input.lastReviewedAt,
        lastReviewedById: input.lastReviewedById,
        reviewDueAt: input.reviewDueAt,
      },
    });
    return toPage(p);
  }

  async setChildTemplate(pageId: string, templateId: string | null): Promise<PageRecord> {
    const p = await this.prisma.page.update({ where: { id: pageId }, data: { childTemplateId: templateId } });
    return toPage(p);
  }

  async setMetadata(pageId: string, metadata: Record<string, unknown>): Promise<PageRecord> {
    // Stored as a serialized string (SQL Server has no Json type); empty object clears it.
    const isEmpty = !metadata || Object.keys(metadata).length === 0;
    const p = await this.prisma.page.update({
      where: { id: pageId },
      data: { metadata: isEmpty ? null : JSON.stringify(metadata) },
    });
    return toPage(p);
  }

  async findByShortId(shortId: string): Promise<PageRecord | null> {
    const p = await this.prisma.page.findUnique({ where: { shortId } });
    return p ? toPage(p) : null;
  }

  async findById(id: string): Promise<PageRecord | null> {
    const p = await this.prisma.page.findUnique({ where: { id } });
    return p ? toPage(p) : null;
  }

  async findByIds(ids: string[]): Promise<PageRecord[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.page.findMany({ where: { id: { in: ids } } });
    return rows.map(toPage);
  }

  async findBySlug(
    spaceId: string,
    parentId: string | null,
    slug: string,
  ): Promise<PageRecord | null> {
    const p = await this.prisma.page.findFirst({ where: { spaceId, parentId, slug } });
    return p ? toPage(p) : null;
  }

  async listBySpace(spaceId: string): Promise<PageRecord[]> {
    const rows = await this.prisma.page.findMany({
      where: { spaceId },
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { title: 'asc' }],
    });
    return rows.map(toPage);
  }

  async listChildren(parentId: string): Promise<PageRecord[]> {
    const rows = await this.prisma.page.findMany({
      where: { parentId },
      orderBy: [{ position: 'asc' }, { title: 'asc' }],
    });
    return rows.map(toPage);
  }

  async countSiblings(spaceId: string, parentId: string | null): Promise<number> {
    return this.prisma.page.count({ where: { spaceId, parentId } });
  }

  async resolveByPath(spaceId: string, slugs: string[]): Promise<PageRecord | null> {
    let parentId: string | null = null;
    let current: PageRecord | null = null;
    for (const slug of slugs) {
      const found: PageRecord | null = await this.findBySlug(spaceId, parentId, slug);
      if (!found) return null;
      current = found;
      parentId = found.id;
    }
    return current;
  }
}
