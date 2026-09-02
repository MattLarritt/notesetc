export interface GroupRecord {
  id: string;
  name: string;
  source: string;
  description: string | null;
  system: boolean;
  createdAt: Date;
}

export interface CreateGroupInput {
  name: string;
  description?: string | null;
  source?: string;
  system?: boolean;
}

/** Persistence boundary for groups + membership (DI token). */
export abstract class GroupRepository {
  abstract list(): Promise<GroupRecord[]>;
  abstract findById(id: string): Promise<GroupRecord | null>;
  abstract findByName(name: string): Promise<GroupRecord | null>;
  abstract create(input: CreateGroupInput): Promise<GroupRecord>;
  abstract update(id: string, input: { name?: string; description?: string | null }): Promise<GroupRecord>;
  abstract delete(id: string): Promise<void>;

  // Membership (custom groups only — system groups derive membership elsewhere).
  abstract listMemberIds(groupId: string): Promise<string[]>;
  abstract memberCount(groupId: string): Promise<number>;
  abstract addMember(groupId: string, userId: string): Promise<void>;
  abstract removeMember(groupId: string, userId: string): Promise<void>;
  abstract isMember(groupId: string, userId: string): Promise<boolean>;
  /** The ids of every (custom) group the user is a member of. */
  abstract listGroupIdsForUser(userId: string): Promise<string[]>;
}
