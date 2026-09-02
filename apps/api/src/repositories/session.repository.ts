export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
}

/** Persistence boundary for sessions (DI token). */
export abstract class SessionRepository {
  abstract create(input: CreateSessionInput): Promise<SessionRecord>;
  abstract findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  abstract revoke(id: string, at: Date): Promise<void>;
}
