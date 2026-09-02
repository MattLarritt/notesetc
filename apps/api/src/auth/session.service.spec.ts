import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CreateSessionInput,
  type SessionRecord,
  SessionRepository,
} from '../repositories/session.repository';
import { SessionService } from './session.service';

class FakeSessionRepository extends SessionRepository {
  rows: SessionRecord[] = [];

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const row: SessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      revokedAt: null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    };
    this.rows.push(row);
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.rows.find((r) => r.tokenHash === tokenHash) ?? null;
  }

  async revoke(id: string, at: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.revokedAt = at;
  }
}

describe('SessionService', () => {
  let repo: FakeSessionRepository;
  let svc: SessionService;

  beforeEach(() => {
    repo = new FakeSessionRepository();
    svc = new SessionService(repo);
  });

  it('issues a session and validates its token', async () => {
    const { token } = await svc.issue('user-1', {});
    expect(token).toBeTruthy();
    // Raw token is never stored — only its hash.
    expect(repo.rows[0].tokenHash).not.toEqual(token);

    const validated = await svc.validate(token);
    expect(validated?.userId).toBe('user-1');
  });

  it('rejects an unknown token', async () => {
    expect(await svc.validate('bogus')).toBeNull();
    expect(await svc.validate('')).toBeNull();
  });

  it('rejects a revoked session', async () => {
    const { token } = await svc.issue('user-1', {});
    await svc.revoke(token);
    expect(await svc.validate(token)).toBeNull();
  });

  it('rejects an expired session', async () => {
    const { token } = await svc.issue('user-1', {});
    repo.rows[0].expiresAt = new Date(Date.now() - 1000);
    expect(await svc.validate(token)).toBeNull();
  });
});
