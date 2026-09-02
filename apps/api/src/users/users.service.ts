import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Action, AuditResult, type GlobalRole, type Principal } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { PasswordService } from '../auth/password.service';
import { type UserRecord, UserRepository } from '../repositories/user.repository';
import type { CreateUserDto, UpdateUserDto } from './dto';

/** User as exposed by the admin API — never includes the password hash. */
export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  authSource: string;
  globalRole: GlobalRole;
  status: 'active' | 'disabled';
  isBreakglass: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function toSafe(u: UserRecord): SafeUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    authSource: u.authSource,
    globalRole: u.globalRole,
    status: u.status,
    isBreakglass: u.isBreakglass,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: Principal, ctx: AuditContext): Promise<SafeUser[]> {
    await this.authz.authorize(principal, Action.AdminUsers, { type: 'global' }, ctx);
    return (await this.users.list()).map(toSafe);
  }

  async create(principal: Principal, dto: CreateUserDto, ctx: AuditContext): Promise<SafeUser> {
    await this.authz.authorize(principal, Action.AdminUsers, { type: 'global' }, ctx);
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException('A user with that email already exists.');
    }
    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.createLocal({
      email: dto.email,
      displayName: dto.displayName,
      passwordHash,
      globalRole: dto.globalRole,
    });
    await this.audit.record(
      principal,
      {
        action: 'user.create',
        result: AuditResult.Success,
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email, globalRole: user.globalRole },
      },
      ctx,
    );
    return toSafe(user);
  }

  async update(
    principal: Principal,
    id: string,
    dto: UpdateUserDto,
    ctx: AuditContext,
  ): Promise<SafeUser> {
    await this.authz.authorize(principal, Action.AdminUsers, { type: 'global' }, ctx);
    const target = await this.users.findById(id);
    if (!target) throw new NotFoundException('User not found.');
    // The breakglass account is governed by environment config, not the portal.
    if (target.isBreakglass) {
      throw new ForbiddenException('The breakglass admin is managed via environment config.');
    }
    // Prevent locking yourself out.
    if (id === principal.userId) {
      if (dto.status === 'disabled' || dto.globalRole === 'member') {
        throw new BadRequestException('You cannot disable or demote your own account.');
      }
    }

    if (dto.status) await this.users.setStatus(id, dto.status);
    if (dto.globalRole) await this.users.setGlobalRole(id, dto.globalRole);

    await this.audit.record(
      principal,
      {
        action: 'user.update',
        result: AuditResult.Success,
        targetType: 'user',
        targetId: id,
        metadata: { ...dto },
      },
      ctx,
    );
    const updated = await this.users.findById(id);
    return toSafe(updated!);
  }
}
