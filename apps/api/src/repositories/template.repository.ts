export interface TemplateRecord {
  id: string;
  spaceId: string;
  name: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplateInput {
  spaceId: string;
  name: string;
  content?: string;
  createdById?: string | null;
}

/** Persistence boundary for page templates (DI token). */
export abstract class TemplateRepository {
  abstract listBySpace(spaceId: string): Promise<TemplateRecord[]>;
  abstract findById(id: string): Promise<TemplateRecord | null>;
  abstract create(input: CreateTemplateInput): Promise<TemplateRecord>;
  abstract update(id: string, input: { name?: string; content?: string }): Promise<TemplateRecord>;
  abstract delete(id: string): Promise<void>;
}
