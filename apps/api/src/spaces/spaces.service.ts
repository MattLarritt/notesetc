import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Action, AuditResult, type Principal, ResourceRole } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { type GrantRecord, GrantRepository } from '../repositories/grant.repository';
import { type SpaceRecord, SpaceRepository } from '../repositories/space.repository';
import type { CreateGrantDto, CreateSpaceDto, UpdateSpaceDto } from './dto';

/**
 * All space + grant operations. Every method authorizes via the shared
 * AuthorizationService before touching data, and every write is audited. This is
 * the same service the REST controller, MCP tools, and admin portal call — so
 * permissions and audit cannot diverge across surfaces.
 */
@Injectable()
export class SpacesService {
  constructor(
    private readonly spaces: SpaceRepository,
    private readonly grants: GrantRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /** Spaces the principal may read, annotated with whether they can reorganize. */
  async list(
    principal: Principal,
    includeArchived = false,
  ): Promise<(SpaceRecord & { canReorganize: boolean })[]> {
    const all = await this.spaces.list(includeArchived);
    return all
      .filter((s) => this.authz.can(principal, Action.SpaceRead, { type: 'space', spaceId: s.id }))
      .map((s) => ({
        ...s,
        canReorganize: this.authz.can(principal, Action.PageReorganize, {
          type: 'space',
          spaceId: s.id,
        }),
      }));
  }

  async get(principal: Principal, id: string, ctx: AuditContext): Promise<SpaceRecord> {
    const space = await this.requireSpace(id);
    await this.authz.authorize(principal, Action.SpaceRead, { type: 'space', spaceId: id }, ctx);
    return space;
  }

  async create(principal: Principal, dto: CreateSpaceDto, ctx: AuditContext): Promise<SpaceRecord> {
    await this.authz.authorize(principal, Action.SpaceCreate, { type: 'global' }, ctx);

    if (await this.spaces.findByKey(dto.key)) {
      throw new ConflictException(`A space with key "${dto.key}" already exists.`);
    }

    const space = await this.spaces.create({
      key: dto.key,
      name: dto.name,
      description: dto.description,
      icon: dto.icon,
      ownerId: principal.userId,
    });

    // The creator becomes space_admin so the space is manageable even if they
    // later lose global_admin.
    await this.grants.create({
      resourceType: 'space',
      resourceId: space.id,
      principalType: 'user',
      principalId: principal.userId,
      role: ResourceRole.SpaceAdmin,
      grantedById: principal.userId,
    });

    await this.audit.record(
      principal,
      {
        action: Action.SpaceCreate,
        result: AuditResult.Success,
        targetType: 'space',
        targetId: space.id,
        spaceId: space.id,
        metadata: { key: space.key, name: space.name },
      },
      ctx,
    );
    return space;
  }

  async update(
    principal: Principal,
    id: string,
    dto: UpdateSpaceDto,
    ctx: AuditContext,
  ): Promise<SpaceRecord> {
    await this.requireSpace(id);
    await this.authz.authorize(principal, Action.SpaceUpdate, { type: 'space', spaceId: id }, ctx);

    const space = await this.spaces.update(id, dto);
    await this.audit.record(
      principal,
      {
        action: Action.SpaceUpdate,
        result: AuditResult.Success,
        targetType: 'space',
        targetId: id,
        spaceId: id,
        metadata: { changed: Object.keys(dto) },
      },
      ctx,
    );
    return space;
  }

  async archive(principal: Principal, id: string, ctx: AuditContext): Promise<SpaceRecord> {
    await this.requireSpace(id);
    await this.authz.authorize(principal, Action.SpaceArchive, { type: 'space', spaceId: id }, ctx);

    const space = await this.spaces.archive(id, new Date());
    await this.audit.record(
      principal,
      {
        action: Action.SpaceArchive,
        result: AuditResult.Success,
        targetType: 'space',
        targetId: id,
        spaceId: id,
      },
      ctx,
    );
    return space;
  }

  async unarchive(principal: Principal, id: string, ctx: AuditContext): Promise<SpaceRecord> {
    await this.requireSpace(id);
    await this.authz.authorize(principal, Action.SpaceArchive, { type: 'space', spaceId: id }, ctx);

    const space = await this.spaces.unarchive(id);
    await this.audit.record(
      principal,
      {
        action: 'space.unarchive',
        result: AuditResult.Success,
        targetType: 'space',
        targetId: id,
        spaceId: id,
      },
      ctx,
    );
    return space;
  }

  async listGrants(principal: Principal, spaceId: string, ctx: AuditContext): Promise<GrantRecord[]> {
    await this.requireSpace(spaceId);
    await this.authz.authorize(
      principal,
      Action.SpaceManageGrants,
      { type: 'space', spaceId },
      ctx,
    );
    return this.grants.listForResource('space', spaceId);
  }

  async addGrant(
    principal: Principal,
    spaceId: string,
    dto: CreateGrantDto,
    ctx: AuditContext,
  ): Promise<GrantRecord> {
    await this.requireSpace(spaceId);
    await this.authz.authorize(
      principal,
      Action.SpaceManageGrants,
      { type: 'space', spaceId },
      ctx,
    );

    const grant = await this.grants.create({
      resourceType: 'space',
      resourceId: spaceId,
      principalType: dto.principalType,
      principalId: dto.principalId,
      role: dto.role,
      grantedById: principal.userId,
    });

    // Permission changes MUST be audited.
    await this.audit.record(
      principal,
      {
        action: 'grant.create',
        result: AuditResult.Success,
        targetType: 'grant',
        targetId: grant.id,
        spaceId,
        metadata: {
          principalType: dto.principalType,
          principalId: dto.principalId,
          role: dto.role,
        },
      },
      ctx,
    );
    return grant;
  }

  async updateGrant(
    principal: Principal,
    spaceId: string,
    grantId: string,
    role: ResourceRole,
    ctx: AuditContext,
  ): Promise<GrantRecord> {
    await this.requireSpace(spaceId);
    await this.authz.authorize(
      principal,
      Action.SpaceManageGrants,
      { type: 'space', spaceId },
      ctx,
    );

    const grant = await this.grants.findById(grantId);
    if (!grant || grant.resourceType !== 'space' || grant.resourceId !== spaceId) {
      throw new NotFoundException('Grant not found on this space.');
    }

    const updated = await this.grants.updateRole(grantId, role);
    await this.audit.record(
      principal,
      {
        action: 'grant.update',
        result: AuditResult.Success,
        targetType: 'grant',
        targetId: grantId,
        spaceId,
        metadata: {
          principalType: grant.principalType,
          principalId: grant.principalId,
          from: grant.role,
          to: role,
        },
      },
      ctx,
    );
    return updated;
  }

  async removeGrant(
    principal: Principal,
    spaceId: string,
    grantId: string,
    ctx: AuditContext,
  ): Promise<void> {
    await this.requireSpace(spaceId);
    await this.authz.authorize(
      principal,
      Action.SpaceManageGrants,
      { type: 'space', spaceId },
      ctx,
    );

    const grant = await this.grants.findById(grantId);
    if (!grant || grant.resourceType !== 'space' || grant.resourceId !== spaceId) {
      throw new NotFoundException('Grant not found on this space.');
    }

    await this.grants.delete(grantId);
    await this.audit.record(
      principal,
      {
        action: 'grant.delete',
        result: AuditResult.Success,
        targetType: 'grant',
        targetId: grantId,
        spaceId,
        metadata: { principalType: grant.principalType, principalId: grant.principalId, role: grant.role },
      },
      ctx,
    );
  }

  private async requireSpace(id: string): Promise<SpaceRecord> {
    const space = await this.spaces.findById(id);
    if (!space) throw new NotFoundException('Space not found.');
    return space;
  }
}
