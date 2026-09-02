import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Action, AuditResult, type Principal } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { PageRepository } from '../repositories/page.repository';
import { SpaceRepository } from '../repositories/space.repository';
import { type TemplateRecord, TemplateRepository } from '../repositories/template.repository';

export interface TemplateSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface ResolvedTemplate {
  templateId: string | null;
  name: string | null;
  content: string;
  /** Where it came from — 'default' is the built-in starter used when none is set. */
  source: 'parent' | 'space' | 'default';
}

/**
 * The absolute built-in starter — a neat, minimal skeleton used for a new page
 * when no space/parent template applies, and as the seed content for a freshly
 * created template. Kept short on purpose; authors flesh it out.
 */
export const DEFAULT_TEMPLATE_CONTENT = `# Overview

One or two sentences on what this document covers and who it's for.

## Details

The main content. Break it into sections with headings, and use lists or tables where they help.

## Related

Links to related pages, tickets, or references.
`;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly templates: TemplateRepository,
    private readonly spaces: SpaceRepository,
    private readonly pages: PageRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private summary = (t: TemplateRecord): TemplateSummary => ({
    id: t.id,
    name: t.name,
    updatedAt: t.updatedAt.toISOString(),
  });

  private async requireSpace(spaceId: string) {
    const s = await this.spaces.findById(spaceId);
    if (!s) throw new NotFoundException('Space not found.');
    return s;
  }
  private async requireTemplate(id: string): Promise<TemplateRecord> {
    const t = await this.templates.findById(id);
    if (!t) throw new NotFoundException('Template not found.');
    return t;
  }

  async list(principal: Principal, spaceId: string, ctx: AuditContext): Promise<TemplateSummary[]> {
    await this.requireSpace(spaceId);
    await this.authz.authorize(principal, Action.SpaceRead, { type: 'space', spaceId }, ctx);
    return (await this.templates.listBySpace(spaceId)).map(this.summary);
  }

  async get(principal: Principal, id: string, ctx: AuditContext): Promise<TemplateRecord> {
    const t = await this.requireTemplate(id);
    await this.authz.authorize(principal, Action.SpaceRead, { type: 'space', spaceId: t.spaceId }, ctx);
    return t;
  }

  async create(principal: Principal, spaceId: string, name: string, ctx: AuditContext): Promise<TemplateRecord> {
    await this.requireSpace(spaceId);
    await this.authz.authorize(principal, Action.TemplateManage, { type: 'space', spaceId }, ctx);
    const t = await this.templates.create({
      spaceId,
      name: name.trim(),
      content: DEFAULT_TEMPLATE_CONTENT,
      createdById: principal.userId,
    });
    await this.audit.record(
      principal,
      { action: 'template.create', result: AuditResult.Success, targetType: 'template', targetId: t.id, spaceId, metadata: { name: t.name } },
      ctx,
    );
    return t;
  }

  async update(
    principal: Principal,
    id: string,
    input: { name?: string; content?: string },
    ctx: AuditContext,
  ): Promise<TemplateRecord> {
    const t = await this.requireTemplate(id);
    await this.authz.authorize(principal, Action.TemplateManage, { type: 'space', spaceId: t.spaceId }, ctx);
    const updated = await this.templates.update(id, { name: input.name?.trim(), content: input.content });
    await this.audit.record(
      principal,
      { action: 'template.update', result: AuditResult.Success, targetType: 'template', targetId: id, spaceId: t.spaceId },
      ctx,
    );
    return updated;
  }

  async remove(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
    const t = await this.requireTemplate(id);
    await this.authz.authorize(principal, Action.TemplateManage, { type: 'space', spaceId: t.spaceId }, ctx);
    const space = await this.spaces.findById(t.spaceId);
    if (space?.defaultTemplateId === id) {
      await this.spaces.update(t.spaceId, { defaultTemplateId: null });
    }
    // Page-level pointers may dangle; resolution tolerates a missing template.
    await this.templates.delete(id);
    await this.audit.record(
      principal,
      { action: 'template.delete', result: AuditResult.Success, targetType: 'template', targetId: id, spaceId: t.spaceId, metadata: { name: t.name } },
      ctx,
    );
  }

  async setSpaceDefault(principal: Principal, spaceId: string, templateId: string | null, ctx: AuditContext): Promise<void> {
    await this.requireSpace(spaceId);
    await this.authz.authorize(principal, Action.TemplateManage, { type: 'space', spaceId }, ctx);
    if (templateId) {
      const t = await this.requireTemplate(templateId);
      if (t.spaceId !== spaceId) throw new BadRequestException('Template belongs to a different space.');
    }
    await this.spaces.update(spaceId, { defaultTemplateId: templateId });
    await this.audit.record(
      principal,
      { action: 'template.space_default', result: AuditResult.Success, targetType: 'space', targetId: spaceId, spaceId, metadata: { templateId } },
      ctx,
    );
  }

  async setPageChildTemplate(principal: Principal, pageId: string, templateId: string | null, ctx: AuditContext): Promise<void> {
    const page = await this.pages.findById(pageId);
    if (!page) throw new NotFoundException('Page not found.');
    await this.authz.authorize(principal, Action.TemplateManage, { type: 'space', spaceId: page.spaceId }, ctx);
    if (templateId) {
      const t = await this.requireTemplate(templateId);
      if (t.spaceId !== page.spaceId) throw new BadRequestException('Template belongs to a different space.');
    }
    await this.pages.setChildTemplate(pageId, templateId);
    await this.audit.record(
      principal,
      { action: 'template.page_child', result: AuditResult.Success, targetType: 'page', targetId: pageId, spaceId: page.spaceId, metadata: { templateId } },
      ctx,
    );
  }

  /** Resolve which template pre-fills a new page: parent's subpage template → space default → none. */
  async resolveForNewPage(
    principal: Principal,
    spaceId: string,
    parentId: string | undefined,
    ctx: AuditContext,
  ): Promise<ResolvedTemplate> {
    await this.requireSpace(spaceId);
    await this.authz.authorize(principal, Action.PageCreate, { type: 'space', spaceId }, ctx);

    if (parentId) {
      const parent = await this.pages.findById(parentId);
      if (parent?.childTemplateId) {
        const t = await this.templates.findById(parent.childTemplateId);
        if (t && t.spaceId === spaceId) return { templateId: t.id, name: t.name, content: t.content, source: 'parent' };
      }
    }
    const space = await this.spaces.findById(spaceId);
    if (space?.defaultTemplateId) {
      const t = await this.templates.findById(space.defaultTemplateId);
      if (t) return { templateId: t.id, name: t.name, content: t.content, source: 'space' };
    }
    return { templateId: null, name: null, content: DEFAULT_TEMPLATE_CONTENT, source: 'default' };
  }
}
