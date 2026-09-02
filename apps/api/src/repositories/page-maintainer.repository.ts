export interface MaintainerRecord {
  id: string;
  pageId: string;
  principalType: 'user' | 'group';
  principalId: string;
  createdAt: Date;
}

/** Persistence boundary for page maintainer assignments (DI token). */
export abstract class PageMaintainerRepository {
  abstract listForPage(pageId: string): Promise<MaintainerRecord[]>;
  abstract findById(id: string): Promise<MaintainerRecord | null>;
  abstract create(input: {
    pageId: string;
    principalType: 'user' | 'group';
    principalId: string;
  }): Promise<MaintainerRecord>;
  abstract delete(id: string): Promise<void>;
  /** Page ids maintained by a user directly, or by any of the given groups. */
  abstract pageIdsForPrincipals(userId: string, groupIds: string[]): Promise<string[]>;
}
