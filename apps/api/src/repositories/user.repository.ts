import type { AuthSource, GlobalRole } from '@notesetc/shared';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  authSource: AuthSource;
  entraOid: string | null;
  passwordHash: string | null;
  isBreakglass: boolean;
  globalRole: GlobalRole;
  status: 'active' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface UpsertBreakglassInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface CreateLocalUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
  globalRole: GlobalRole;
}

/** Persistence boundary for users (DI token). */
export abstract class UserRepository {
  abstract findByEmail(email: string): Promise<UserRecord | null>;
  abstract findById(id: string): Promise<UserRecord | null>;
  abstract findBreakglass(): Promise<UserRecord | null>;
  abstract findByIds(ids: string[]): Promise<UserRecord[]>;
  abstract list(): Promise<UserRecord[]>;
  abstract createLocal(input: CreateLocalUserInput): Promise<UserRecord>;
  abstract setStatus(id: string, status: 'active' | 'disabled'): Promise<void>;
  abstract setGlobalRole(id: string, role: GlobalRole): Promise<void>;
  abstract recordLogin(id: string, at: Date): Promise<void>;
  /** Create or update the breakglass admin, forcing global_admin + active. */
  abstract upsertBreakglass(input: UpsertBreakglassInput): Promise<UserRecord>;
}
