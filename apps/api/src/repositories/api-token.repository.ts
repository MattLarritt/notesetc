export interface ApiTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  ownerUserId: string;
  /** null = full owner scope; otherwise the token is restricted to these spaces. */
  allowedSpaceIds: string[] | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiTokenInput {
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  ownerUserId: string;
  allowedSpaceIds?: string[] | null;
  expiresAt?: Date | null;
}

/** Persistence boundary for API tokens (DI token). */
export abstract class ApiTokenRepository {
  abstract create(input: CreateApiTokenInput): Promise<ApiTokenRecord>;
  abstract findByPrefix(prefix: string): Promise<ApiTokenRecord | null>;
  abstract findById(id: string): Promise<ApiTokenRecord | null>;
  abstract list(): Promise<ApiTokenRecord[]>;
  abstract revoke(id: string, at: Date): Promise<void>;
  /** Rotation: replace the secret hash (and optionally the lookup prefix). */
  abstract updateSecret(id: string, tokenHash: string, tokenPrefix: string): Promise<void>;
  abstract touchLastUsed(id: string, at: Date): Promise<void>;
}
