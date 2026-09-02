import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Action, AuditResult, GlobalRole, type Principal, SYSTEM_GROUP } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { type GroupRecord, GroupRepository } from '../repositories/group.repository';
import { GrantRepository } from '../repositories/grant.repository';
import { UserRepository } from '../repositories/user.repository';
import type { CreateGroupDto, UpdateGroupDto } from './dto';

/** How a group behaves. Administrators / All Users / Public are seeded systems. */
type GroupKind = 'administrators' | 'all_users' | 'public' | 'custom';

export interface GroupSummary extends GroupRecord {
  kind: GroupKind;
  memberCount: number;
  /** Whether membership can be edited (All Users is implicit → read-only). */
  editableMembers: boolean;
}

export interface MemberSummary {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

@Injectable()
export class GroupsService {
  constructor(
    private readonly groups: GroupRepository,
    private readonly users: UserRepository,
    private readonly grants: GrantRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private kindOf(g: GroupRecord): GroupKind {
    if (g.system && g.name === SYSTEM_GROUP.Administrators) return 'administrators';
    if (g.system && g.name === SYSTEM_GROUP.AllUsers) return 'all_users';
    if (g.system && g.name === SYSTEM_GROUP.Public) return 'public';
    return 'custom';
  }

  private async require(id: string): Promise<GroupRecord> {
    const g = await this.groups.findById(id);
    if (!g) throw new NotFoundException('Group not found.');
    return g;
  }

  private async gate(principal: Principal, ctx: AuditContext): Promise<void> {
    await this.authz.authorize(principal, Action.AdminGroups, { type: 'global' }, ctx);
  }

  async list(principal: Principal, ctx: AuditContext): Promise<GroupSummary[]> {
    await this.gate(principal, ctx);
    const all = await this.groups.list();
    const admins = (await this.users.list()).filter((u) => u.globalRole === GlobalRole.GlobalAdmin);
    const activeCount = (await this.users.list()).filter((u) => u.status === 'active').length;
    const out: GroupSummary[] = [];
    for (const g of all) {
      const kind = this.kindOf(g);
      const memberCount =
        kind === 'administrators'
          ? admins.length
          : kind === 'all_users'
            ? activeCount
            : kind === 'public'
              ? 0 // nobody is a member of Public — it's implicit for everyone
              : await this.groups.memberCount(g.id);
      // Membership is only editable for custom + Administrators groups.
      out.push({ ...g, kind, memberCount, editableMembers: kind === 'custom' || kind === 'administrators' });
    }
    return out;
  }

  async create(principal: Principal, dto: CreateGroupDto, ctx: AuditContext): Promise<GroupRecord> {
    await this.gate(principal, ctx);
    const name = dto.name.trim();
    if (
      name === SYSTEM_GROUP.Administrators ||
      name === SYSTEM_GROUP.AllUsers ||
      name === SYSTEM_GROUP.Public
    ) {
      throw new ConflictException('That name is reserved for a system group.');
    }
    if (await this.groups.findByName(name)) {
      throw new ConflictException(`A group named "${name}" already exists.`);
    }
    const group = await this.groups.create({ name, description: dto.description ?? null });
    await this.audit.record(
      principal,
      { action: 'group.create', result: AuditResult.Success, targetType: 'group', targetId: group.id, metadata: { name } },
      ctx,
    );
    return group;
  }

  async update(principal: Principal, id: string, dto: UpdateGroupDto, ctx: AuditContext): Promise<GroupRecord> {
    await this.gate(principal, ctx);
    const group = await this.require(id);
    if (group.system) throw new ForbiddenException('System groups cannot be edited.');
    if (dto.name && dto.name.trim() !== group.name) {
      const existing = await this.groups.findByName(dto.name.trim());
      if (existing) throw new ConflictException('A group with that name already exists.');
    }
    const updated = await this.groups.update(id, {
      name: dto.name?.trim(),
      description: dto.description,
    });
    await this.audit.record(
      principal,
      { action: 'group.update', result: AuditResult.Success, targetType: 'group', targetId: id },
      ctx,
    );
    return updated;
  }

  async remove(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
    await this.gate(principal, ctx);
    const group = await this.require(id);
    if (group.system) throw new ForbiddenException('System groups cannot be deleted.');
    // Clean up any space grants held by this group so nothing dangles.
    await this.grants.deleteForPrincipal('group', id);
    await this.groups.delete(id);
    await this.audit.record(
      principal,
      { action: 'group.delete', result: AuditResult.Success, targetType: 'group', targetId: id, metadata: { name: group.name } },
      ctx,
    );
  }

  async listMembers(principal: Principal, id: string, ctx: AuditContext): Promise<MemberSummary[]> {
    await this.gate(principal, ctx);
    const group = await this.require(id);
    const kind = this.kindOf(group);
    const toSummary = (u: { id: string; email: string; displayName: string; status: string }): MemberSummary => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
    });

    if (kind === 'administrators') {
      return (await this.users.list())
        .filter((u) => u.globalRole === GlobalRole.GlobalAdmin)
        .map(toSummary);
    }
    if (kind === 'all_users') {
      return (await this.users.list()).filter((u) => u.status === 'active').map(toSummary);
    }
    if (kind === 'public') {
      return []; // Public has no members — it applies to everyone, incl. anonymous.
    }
    const ids = await this.groups.listMemberIds(id);
    return (await this.users.findByIds(ids)).map(toSummary);
  }

  async addMember(principal: Principal, id: string, userId: string, ctx: AuditContext): Promise<void> {
    await this.gate(principal, ctx);
    const group = await this.require(id);
    const kind = this.kindOf(group);
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found.');

    if (kind === 'all_users') {
      throw new BadRequestException('Every user already belongs to "All Users".');
    }
    if (kind === 'public') {
      throw new BadRequestException('The "Public" group is implicit — you cannot add members to it.');
    }
    if (kind === 'administrators') {
      // Making someone an administrator = granting global_admin.
      await this.users.setGlobalRole(userId, GlobalRole.GlobalAdmin);
    } else {
      await this.groups.addMember(id, userId);
    }
    await this.audit.record(
      principal,
      { action: 'group.member.add', result: AuditResult.Success, targetType: 'group', targetId: id, metadata: { userId } },
      ctx,
    );
  }

  async removeMember(principal: Principal, id: string, userId: string, ctx: AuditContext): Promise<void> {
    await this.gate(principal, ctx);
    const group = await this.require(id);
    const kind = this.kindOf(group);
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found.');

    if (kind === 'all_users') {
      throw new BadRequestException('You cannot remove someone from "All Users".');
    }
    if (kind === 'public') {
      throw new BadRequestException('The "Public" group has no members to remove.');
    }
    if (kind === 'administrators') {
      if (user.isBreakglass) {
        throw new BadRequestException('The breakglass admin cannot be removed from Administrators.');
      }
      const adminCount = (await this.users.list()).filter(
        (u) => u.globalRole === GlobalRole.GlobalAdmin,
      ).length;
      if (adminCount <= 1) {
        throw new BadRequestException('At least one administrator must remain.');
      }
      await this.users.setGlobalRole(userId, GlobalRole.Member);
    } else {
      await this.groups.removeMember(id, userId);
    }
    await this.audit.record(
      principal,
      { action: 'group.member.remove', result: AuditResult.Success, targetType: 'group', targetId: id, metadata: { userId } },
      ctx,
    );
  }
}
