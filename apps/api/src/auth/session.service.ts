import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SessionRepository } from '../repositories/session.repository';

export interface IssuedSession {
  /** Raw opaque token to place in the client cookie. Never stored server-side. */
  token: string;
  expiresAt: Date;
}

export interface ValidatedSession {
  sessionId: string;
  userId: string;
}

/** Session lifetime. Kept modest; refresh/rotation is a later concern. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

@Injectable()
export class SessionService {
  constructor(private readonly sessions: SessionRepository) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(userId: string, ctx: { ip?: string; userAgent?: string }): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url'); // 256 bits of entropy
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessions.create({
      userId,
      tokenHash: this.hashToken(token),
      expiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { token, expiresAt };
  }

  /** Returns the session if the token is valid, unexpired, and unrevoked. */
  async validate(token: string): Promise<ValidatedSession | null> {
    if (!token) return null;
    const record = await this.sessions.findByTokenHash(this.hashToken(token));
    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt.getTime() <= Date.now()) return null;
    return { sessionId: record.id, userId: record.userId };
  }

  async revoke(token: string): Promise<void> {
    const record = await this.sessions.findByTokenHash(this.hashToken(token));
    if (record && !record.revokedAt) {
      await this.sessions.revoke(record.id, new Date());
    }
  }
}
