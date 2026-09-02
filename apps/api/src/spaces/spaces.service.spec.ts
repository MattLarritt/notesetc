import { ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { GlobalRole, type Principal, ResourceRole } from '@notesetc/shared';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { type AuditEntry, AuditRepository } from '../repositories/audit.repository';
import {
  type CreateGrantInput,
  type GrantRecord,
  GrantRepository,
} from '../repositories/grant.repository';
import {
  type CreateSpaceInput,
  type SpaceRecord,
  SpaceRepository,
  type UpdateSpaceInput,
} from '../repositories/space.repository';
import { SpacesService } from './spaces.service';

class FakeAuditRepository extends AuditRepository {
  entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

let idSeq = 0;
class FakeSpaceRepository extends SpaceRepository {
  rows: SpaceRecord[] = [];
  async list(includeArchived: boolean): Promise<SpaceRecord[]> {
    return this.rows.filter((s) => includeArchived || s.status === 'active');
  }
  async findById(id: string): Promise<SpaceRecord | null> {
    return this.rows.find((s) => s.id === id) ?? null;
  }
  async findByKey(key: string): Promise<SpaceRecord | null> {
    return this.rows.find((s) => s.key === key) ?? null;
  }
  async create(input: CreateSpaceInput): Promise<SpaceRecord> {
    const s: SpaceRecord = {
      id: `space-${++idSeq}`,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      ownerId: input.ownerId ?? null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
    this.rows.push(s);
    return s;
  }
  async update(id: string, input: UpdateSpaceInput): Promise<SpaceRecord> {
    const s = this.rows.find((x) => x.id === id)!;
    Object.assign(s, input);
    return s;
  }
  async archive(id: string, at: Date): Promise<SpaceRecord> {
    const s = this.rows.find((x) => x.id === id)!;
    s.status = 'archived';
    s.archivedAt = at;
    return s;
  }
}

class FakeGrantRepository extends GrantRepository {
  rows: GrantRecord[] = [];
  async listForResource(): Promise<GrantRecord[]> {
    return this.rows;
  }
  async create(input: CreateGrantInput): Promise<GrantRecord> {
    const g: GrantRecord = { id: `grant-${++idSeq}`, grantedById: input.grantedById ?? null, createdAt: new Date(), ...input };
    this.rows.push(g);
    return g;
  }
  async findById(id: string): Promise<GrantRecord | null> {
    return this.rows.find((g) => g.id === id) ?? null;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((g) => g.id !== id);
  }
  async resolveForUser(): Promise<never[]> {
    return [];
  }
}

function principal(globalRole: GlobalRole, grants: Principal['grants'] = []): Principal {
  return {
    userId: 'u1',
    email: 'u1@example.com',
    globalRole,
    grants,
    via: 'session',
    actorType: 'human',
  };
}

describe('SpacesService', () => {
  let spaces: FakeSpaceRepository;
  let grants: FakeGrantRepository;
  let audit: FakeAuditRepository;
  let svc: SpacesService;

  beforeEach(() => {
    spaces = new FakeSpaceRepository();
    grants = new FakeGrantRepository();
    audit = new FakeAuditRepository();
    const auditSvc = new AuditService(audit);
    svc = new SpacesService(spaces, grants, new AuthorizationService(auditSvc), auditSvc);
  });

  const admin = principal(GlobalRole.GlobalAdmin);

  it('lets a global admin create a space, auto-grants owner space_admin, and audits it', async () => {
    const space = await svc.create(admin, { key: 'IT', name: 'IT' }, {});
    expect(space.key).toBe('IT');
    expect(grants.rows).toContainEqual(
      expect.objectContaining({ resourceId: space.id, principalId: 'u1', role: ResourceRole.SpaceAdmin }),
    );
    expect(audit.entries.some((e) => e.action === 'space.create' && e.result === 'success')).toBe(true);
  });

  it('denies space creation to a non-global-admin and audits the denial', async () => {
    const member = principal(GlobalRole.Member);
    await expect(svc.create(member, { key: 'IT', name: 'IT' }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.entries.some((e) => e.action === 'space.create' && e.result === 'denied')).toBe(true);
  });

  it('rejects a duplicate space key', async () => {
    await svc.create(admin, { key: 'IT', name: 'IT' }, {});
    await expect(svc.create(admin, { key: 'IT', name: 'Dup' }, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows update by a space_admin but denies a viewer', async () => {
    const space = await svc.create(admin, { key: 'IT', name: 'IT' }, {});

    const spaceAdmin = principal(GlobalRole.Member, [
      { resourceType: 'space', resourceId: space.id, role: ResourceRole.SpaceAdmin },
    ]);
    await expect(svc.update(spaceAdmin, space.id, { name: 'IT Renamed' }, {})).resolves.toMatchObject(
      { name: 'IT Renamed' },
    );

    const viewer = principal(GlobalRole.Member, [
      { resourceType: 'space', resourceId: space.id, role: ResourceRole.Viewer },
    ]);
    await expect(svc.update(viewer, space.id, { name: 'nope' }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('filters list() to spaces the principal may read', async () => {
    const a = await svc.create(admin, { key: 'IT', name: 'IT' }, {});
    const b = await svc.create(admin, { key: 'HR', name: 'HR' }, {});

    // A member with a viewer grant on only one space sees only that one.
    const member = principal(GlobalRole.Member, [
      { resourceType: 'space', resourceId: b.id, role: ResourceRole.Viewer },
    ]);
    const visible = await svc.list(member);
    expect(visible.map((s) => s.id)).toEqual([b.id]);

    // Global admin sees all.
    expect((await svc.list(admin)).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('audits grant creation as a permission change', async () => {
    const space = await svc.create(admin, { key: 'IT', name: 'IT' }, {});
    await svc.addGrant(admin, space.id, { principalType: 'user', principalId: 'u2', role: ResourceRole.Editor }, {});
    expect(audit.entries.some((e) => e.action === 'grant.create' && e.result === 'success')).toBe(true);
  });
});
