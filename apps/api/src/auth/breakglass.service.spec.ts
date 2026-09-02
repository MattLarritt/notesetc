import { beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { type AuditEntry, AuditRepository } from '../repositories/audit.repository';
import {
  type UpsertBreakglassInput,
  type UserRecord,
  UserRepository,
} from '../repositories/user.repository';
import type { ConfigService } from '../config/config.service';
import { BreakglassService } from './breakglass.service';
import { PasswordService } from './password.service';

class FakeAuditRepository extends AuditRepository {
  entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeUserRepository extends UserRepository {
  breakglass: UserRecord | null = null;
  upserted: UpsertBreakglassInput | null = null;
  statusChanges: Array<{ id: string; status: string }> = [];

  async findByEmail(): Promise<UserRecord | null> {
    return null;
  }
  async findById(): Promise<UserRecord | null> {
    return null;
  }
  async findBreakglass(): Promise<UserRecord | null> {
    return this.breakglass;
  }
  async setStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
    this.statusChanges.push({ id, status });
    if (this.breakglass && this.breakglass.id === id) this.breakglass.status = status;
  }
  async recordLogin(): Promise<void> {}
  async upsertBreakglass(input: UpsertBreakglassInput): Promise<UserRecord> {
    this.upserted = input;
    return {
      id: 'bg-1',
      email: input.email,
      displayName: input.displayName,
      authSource: 'local',
      entraOid: null,
      passwordHash: input.passwordHash,
      isBreakglass: true,
      globalRole: 'global_admin',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    };
  }
}

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('BreakglassService', () => {
  let users: FakeUserRepository;
  let audit: FakeAuditRepository;
  let passwords: PasswordService;

  beforeEach(() => {
    users = new FakeUserRepository();
    audit = new FakeAuditRepository();
    passwords = new PasswordService();
  });

  function build(config: ConfigService): BreakglassService {
    return new BreakglassService(config, users, passwords, new AuditService(audit));
  }

  it('upserts an active admin when email + password are configured', async () => {
    const svc = build(
      fakeConfig({
        BREAKGLASS_ADMIN_EMAIL: 'admin@example.com',
        BREAKGLASS_ADMIN_PASSWORD: 'a-strong-password',
      }),
    );
    await svc.onApplicationBootstrap();

    expect(users.upserted?.email).toBe('admin@example.com');
    expect(users.upserted?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(audit.entries.some((e) => e.action === 'auth.breakglass.bootstrap' && e.result === 'success')).toBe(true);
  });

  it('does not create the admin if no password/hash is provided', async () => {
    const svc = build(fakeConfig({ BREAKGLASS_ADMIN_EMAIL: 'admin@example.com' }));
    await svc.onApplicationBootstrap();

    expect(users.upserted).toBeNull();
    expect(audit.entries.some((e) => e.result === 'error')).toBe(true);
  });

  it('DISABLES an existing breakglass admin when email is removed from env', async () => {
    users.breakglass = {
      id: 'bg-1',
      email: 'admin@example.com',
      displayName: 'Breakglass Admin',
      authSource: 'local',
      entraOid: null,
      passwordHash: 'x',
      isBreakglass: true,
      globalRole: 'global_admin',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    };
    const svc = build(fakeConfig({})); // no BREAKGLASS_ADMIN_EMAIL
    await svc.onApplicationBootstrap();

    expect(users.statusChanges).toContainEqual({ id: 'bg-1', status: 'disabled' });
    expect(audit.entries.some((e) => e.action === 'auth.breakglass.disabled')).toBe(true);
  });

  it('does nothing when email is absent and no breakglass exists', async () => {
    const svc = build(fakeConfig({}));
    await svc.onApplicationBootstrap();
    expect(users.statusChanges).toHaveLength(0);
  });
});
