import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { type AuditEntry, AuditRepository } from '../repositories/audit.repository';
import {
  type CreateSessionInput,
  type SessionRecord,
  SessionRepository,
} from '../repositories/session.repository';
import {
  type UpsertBreakglassInput,
  type UserRecord,
  UserRepository,
} from '../repositories/user.repository';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

class FakeAuditRepository extends AuditRepository {
  entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeSessionRepository extends SessionRepository {
  async create(input: CreateSessionInput): Promise<SessionRecord> {
    return {
      id: 'sess-1',
      userId: input.userId,
      tokenHash: input.tokenHash,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      revokedAt: null,
      ip: null,
      userAgent: null,
    };
  }
  async findByTokenHash(): Promise<SessionRecord | null> {
    return null;
  }
  async revoke(): Promise<void> {}
}

class FakeUserRepository extends UserRepository {
  users: UserRecord[] = [];
  loginRecorded: string[] = [];

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async findById(id: string): Promise<UserRecord | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async findBreakglass(): Promise<UserRecord | null> {
    return this.users.find((u) => u.isBreakglass) ?? null;
  }
  async setStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
    const u = this.users.find((x) => x.id === id);
    if (u) u.status = status;
  }
  async recordLogin(id: string): Promise<void> {
    this.loginRecorded.push(id);
  }
  async upsertBreakglass(_input: UpsertBreakglassInput): Promise<UserRecord> {
    throw new Error('not used');
  }
}

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u1',
    email: 'admin@example.com',
    displayName: 'Admin',
    authSource: 'local',
    entraOid: null,
    passwordHash: null,
    isBreakglass: true,
    globalRole: 'global_admin',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    ...overrides,
  };
}

describe('AuthService.login', () => {
  let users: FakeUserRepository;
  let audit: FakeAuditRepository;
  let passwords: PasswordService;
  let svc: AuthService;

  beforeEach(() => {
    users = new FakeUserRepository();
    audit = new FakeAuditRepository();
    passwords = new PasswordService();
    const sessions = new SessionService(new FakeSessionRepository());
    svc = new AuthService(users, passwords, sessions, new AuditService(audit));
  });

  async function seedUser(password: string, overrides: Partial<UserRecord> = {}): Promise<void> {
    users.users.push(makeUser({ passwordHash: await passwords.hash(password), ...overrides }));
  }

  it('logs in with correct credentials and audits success', async () => {
    await seedUser('s3cret-password');
    const result = await svc.login({ email: 'admin@example.com', password: 's3cret-password' }, {});

    expect(result.user.email).toBe('admin@example.com');
    expect(result.session.token).toBeTruthy();
    expect(users.loginRecorded).toContain('u1');

    const success = audit.entries.find((e) => e.action === 'auth.login' && e.result === 'success');
    expect(success).toBeTruthy();
    expect(success?.actorType).toBe('human');
  });

  it('rejects a wrong password with a generic error and audits denial', async () => {
    await seedUser('s3cret-password');
    await expect(
      svc.login({ email: 'admin@example.com', password: 'wrong' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const denied = audit.entries.find((e) => e.action === 'auth.login' && e.result === 'denied');
    expect(denied?.metadata?.reason).toBe('bad_password');
  });

  it('rejects a disabled account', async () => {
    await seedUser('s3cret-password', { status: 'disabled' });
    await expect(
      svc.login({ email: 'admin@example.com', password: 's3cret-password' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const denied = audit.entries.find((e) => e.result === 'denied');
    expect(denied?.metadata?.reason).toBe('account_disabled');
  });

  it('rejects an unknown user without leaking existence', async () => {
    await expect(
      svc.login({ email: 'ghost@example.com', password: 'whatever' }, {}),
    ).rejects.toThrow('Invalid email or password.');

    const denied = audit.entries.find((e) => e.result === 'denied');
    expect(denied?.metadata?.reason).toBe('no_such_user');
  });
});
