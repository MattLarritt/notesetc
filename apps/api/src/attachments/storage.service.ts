import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { ConfigService } from '../config/config.service';

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
  checksumSha256: string;
}

/**
 * Binary object store for attachments. Interface (DI token) so the backing store
 * can be swapped — POC writes to a local volume; a future impl could target S3/
 * Azure Blob without touching the service layer. Bytes never live in the web root.
 */
export abstract class StorageService {
  /**
   * `folder` groups objects per workspace (space key) so operators can browse
   * the store by space. A future cloud-backed impl (OneDrive/SharePoint/GDrive,
   * resolved per space from admin-connected credentials) receives the same
   * folder hint and maps it to its own hierarchy.
   */
  abstract save(bytes: Buffer, extension: string, folder?: string): Promise<StoredObject>;
  abstract read(storageKey: string): Promise<Buffer>;
  abstract delete(storageKey: string): Promise<void>;
}

@Injectable()
export class LocalDiskStorageService extends StorageService implements OnModuleInit {
  private readonly logger = new Logger(LocalDiskStorageService.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.get('STORAGE_DIR'));
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    this.logger.log(`Attachment storage at ${this.root}`);
  }

  /** Reject keys that try to escape the storage root (defence in depth). */
  private pathFor(storageKey: string): string {
    const full = resolve(this.root, storageKey);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('invalid storage key');
    }
    return full;
  }

  async save(bytes: Buffer, extension: string, folder?: string): Promise<StoredObject> {
    const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const dir = (folder ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const name = ext ? `${randomUUID()}.${ext}` : randomUUID();
    const storageKey = dir ? `${dir}/${name}` : name;
    const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
    if (dir) await fs.mkdir(this.pathFor(dir), { recursive: true });
    await fs.writeFile(this.pathFor(storageKey), bytes);
    return { storageKey, sizeBytes: bytes.length, checksumSha256 };
  }

  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.pathFor(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await fs.rm(this.pathFor(storageKey), { force: true });
  }
}
