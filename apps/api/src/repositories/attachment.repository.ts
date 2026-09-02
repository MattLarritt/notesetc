export interface AttachmentRecord {
  id: string;
  spaceId: string;
  pageId: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  checksumSha256: string;
  scanStatus: 'pending' | 'clean' | 'blocked';
  uploadedById: string | null;
  authorType: string;
  createdAt: Date;
}

export interface CreateAttachmentInput {
  spaceId: string;
  pageId?: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  checksumSha256: string;
  scanStatus?: 'pending' | 'clean' | 'blocked';
  uploadedById?: string | null;
  authorType: string;
}

/** Persistence boundary for attachments metadata (DI token). */
export abstract class AttachmentRepository {
  abstract create(input: CreateAttachmentInput): Promise<AttachmentRecord>;
  abstract findById(id: string): Promise<AttachmentRecord | null>;
  /** Attachments in a space, newest first; optionally only those linked to a page. */
  abstract list(spaceId: string, pageId?: string): Promise<AttachmentRecord[]>;
  abstract setPageId(id: string, pageId: string | null): Promise<void>;
}
