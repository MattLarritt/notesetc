export interface SpaceRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  overview: string | null;
  ownerId: string | null;
  status: 'active' | 'archived';
  defaultTemplateId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateSpaceInput {
  key: string;
  name: string;
  description?: string;
  icon?: string;
  ownerId?: string;
}

export interface UpdateSpaceInput {
  name?: string;
  description?: string;
  icon?: string | null;
  overview?: string | null;
  defaultTemplateId?: string | null;
}

/** Persistence boundary for spaces (DI token). */
export abstract class SpaceRepository {
  abstract list(includeArchived: boolean): Promise<SpaceRecord[]>;
  abstract findById(id: string): Promise<SpaceRecord | null>;
  abstract findByKey(key: string): Promise<SpaceRecord | null>;
  abstract create(input: CreateSpaceInput): Promise<SpaceRecord>;
  abstract update(id: string, input: UpdateSpaceInput): Promise<SpaceRecord>;
  abstract archive(id: string, at: Date): Promise<SpaceRecord>;
  abstract unarchive(id: string): Promise<SpaceRecord>;
}
