import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Action, AuditResult, type Principal } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import {
  type AttachmentRecord,
  AttachmentRepository,
} from '../repositories/attachment.repository';
import { SpaceRepository } from '../repositories/space.repository';
import { StorageService } from './storage.service';

/** 25 MB cap for documents; images keep the original 10 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Byte-level shape a file must sniff as. Office 2007+ formats are zip
 * containers; legacy .doc is an OLE compound file; txt/csv have no magic and
 * are checked for being sane text instead.
 */
type SniffKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'ole' | 'text';

interface AllowedType {
  ext: string;
  kind: SniffKind;
  image: boolean;
  /** Safe to serve inline in a browser (no active-content risk). */
  inline: boolean;
}

/** Allowed upload types. SVG stays excluded (script risk); HTML likewise. */
const ALLOWED: Record<string, AllowedType> = {
  'image/png': { ext: 'png', kind: 'png', image: true, inline: true },
  'image/jpeg': { ext: 'jpg', kind: 'jpeg', image: true, inline: true },
  'image/gif': { ext: 'gif', kind: 'gif', image: true, inline: true },
  'image/webp': { ext: 'webp', kind: 'webp', image: true, inline: true },
  'application/pdf': { ext: 'pdf', kind: 'pdf', image: false, inline: true },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx', kind: 'zip', image: false, inline: false,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx', kind: 'zip', image: false, inline: false,
  },
  'application/msword': { ext: 'doc', kind: 'ole', image: false, inline: false },
  'text/plain': { ext: 'txt', kind: 'text', image: false, inline: true },
  'text/csv': { ext: 'csv', kind: 'text', image: false, inline: true },
};

/** Filename-extension fallback for browsers that upload with a generic type. */
const BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED).map(([mime, t]) => [t.ext, mime]),
);
BY_EXTENSION['jpeg'] = 'image/jpeg';

/** Windows commonly labels .csv as Excel; normalise it. */
const MIME_ALIASES: Record<string, string> = {
  'application/vnd.ms-excel': 'text/csv',
};

/** Sniff the leading bytes so a mislabelled/disguised upload is rejected. */
function sniff(buf: Buffer): SniffKind | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38)
    return 'gif';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)
    return 'zip';
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
    return 'ole';
  // Text has no magic: accept if the first 8 KB contain no NUL bytes.
  if (buf.length > 0 && !buf.subarray(0, 8192).includes(0)) return 'text';
  return null;
}

/**
 * Resolve the canonical content type for an upload: the declared mimetype when
 * it is one we allow (after aliasing), otherwise the filename extension.
 */
function resolveType(mimetype: string, filename: string): { mime: string; type: AllowedType } | null {
  const declared = MIME_ALIASES[mimetype] ?? mimetype;
  if (ALLOWED[declared]) return { mime: declared, type: ALLOWED[declared] };
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const byExt = BY_EXTENSION[ext];
  if (byExt) return { mime: byExt, type: ALLOWED[byExt] };
  return null;
}

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly repo: AttachmentRepository,
    private readonly spaces: SpaceRepository,
    private readonly storage: StorageService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    principal: Principal,
    spaceId: string,
    file: UploadedFile | undefined,
    pageId: string | undefined,
    ctx: AuditContext,
  ): Promise<{ id: string; url: string; filename: string; contentType: string; sizeBytes: number }> {
    await this.authz.authorize(principal, Action.AttachmentUpload, { type: 'space', spaceId }, ctx);
    const space = await this.spaces.findById(spaceId);
    if (!space) throw new NotFoundException('Space not found.');

    if (!file || !file.buffer?.length) throw new BadRequestException('No file provided.');
    const resolved = resolveType(file.mimetype ?? '', file.originalname ?? '');
    if (!resolved) {
      throw new UnsupportedMediaTypeException(
        'Allowed types: PNG, JPEG, GIF, WebP, PDF, DOCX, DOC, XLSX, TXT, CSV.',
      );
    }
    const cap = resolved.type.image ? MAX_IMAGE_BYTES : MAX_UPLOAD_BYTES;
    if (file.size > cap || file.buffer.length > cap) {
      throw new PayloadTooLargeException(
        `File exceeds the ${Math.round(cap / 1024 / 1024)} MB limit.`,
      );
    }
    // Trust the bytes, not the declared type: the magic number must match the
    // byte-shape of the resolved type (zip for docx/xlsx, OLE for doc, …).
    const sniffed = sniff(file.buffer);
    if (sniffed !== resolved.type.kind) {
      throw new UnsupportedMediaTypeException(
        'File contents do not match the declared type.',
      );
    }

    // One folder per workspace, named by space key, so the store is browsable.
    const stored = await this.storage.save(file.buffer, resolved.type.ext, space.key);
    const record = await this.repo.create({
      spaceId,
      pageId: pageId ?? null,
      filename: file.originalname?.slice(0, 200) || `file.${resolved.type.ext}`,
      contentType: resolved.mime,
      sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey,
      checksumSha256: stored.checksumSha256,
      scanStatus: 'clean', // no AV scanner in the POC; hook here later
      uploadedById: principal.userId,
      authorType: principal.actorType,
    });

    await this.audit.record(
      principal,
      {
        action: Action.AttachmentUpload,
        result: AuditResult.Success,
        targetType: 'attachment',
        targetId: record.id,
        spaceId,
        metadata: { filename: record.filename, contentType: record.contentType, sizeBytes: record.sizeBytes },
      },
      ctx,
    );

    return {
      id: record.id,
      url: `/attachments/${record.id}`,
      filename: record.filename,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
    };
  }

  /** Whether this content type may be served inline (vs. forced download). */
  static isInline(contentType: string): boolean {
    return ALLOWED[contentType]?.inline ?? false;
  }

  /** List attachments in a space (optionally one page's), read-gated like serving. */
  async list(
    principal: Principal,
    spaceId: string,
    pageId: string | undefined,
    ctx: AuditContext,
  ): Promise<{ id: string; filename: string; contentType: string; sizeBytes: number; pageId: string | null; createdAt: Date }[]> {
    await this.authz.authorize(principal, Action.AttachmentRead, { type: 'space', spaceId }, ctx);
    if (!(await this.spaces.findById(spaceId))) throw new NotFoundException('Space not found.');
    const rows = await this.repo.list(spaceId, pageId);
    return rows
      .filter((r) => r.scanStatus !== 'blocked')
      .map((r) => ({
        id: r.id,
        filename: r.filename,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        pageId: r.pageId,
        createdAt: r.createdAt,
      }));
  }

  /**
   * Extracted text content for agent consumption. txt/csv are returned as-is;
   * PDF (pdf-parse), Word docx (mammoth) and Excel xlsx (SheetJS, one CSV block
   * per sheet) are extracted server-side so MCP clients can read manuals and
   * documents without fetching bytes. Legacy .doc and images have no extractor.
   * Output capped at 256 KB.
   */
  async getTextContent(
    principal: Principal,
    id: string,
    ctx: AuditContext,
  ): Promise<{ contentType: string; text: string; truncated: boolean }> {
    const record = await this.findReadable(principal, id, ctx);
    const type = record.contentType;
    const bytes = await this.storage.read(record.storageKey);
    let text: string;

    if (type.startsWith('text/')) {
      text = bytes.toString('utf8');
    } else if (type === 'application/pdf') {
      // unpdf ships a DOM-free pdf.js build, so extraction works in the
      // container without canvas/DOMMatrix polyfills.
      const { extractText } = await import('unpdf');
      const extracted = await extractText(new Uint8Array(bytes), { mergePages: true });
      text = extracted.text;
    } else if (
      type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const mammoth = await import('mammoth');
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } else if (
      type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(bytes, { type: 'buffer' });
      text = wb.SheetNames.map(
        (name) => `## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`,
      ).join('\n\n');
    } else {
      throw new BadRequestException(
        `No text extractor for ${type}; fetch the bytes via GET /api/v1/attachments/${id}.`,
      );
    }

    const cap = 256 * 1024;
    return {
      contentType: type,
      text: text.length > cap ? text.slice(0, cap) : text,
      truncated: text.length > cap,
    };
  }

  /** Metadata only — lets the viewer pick a renderer before fetching bytes. */
  async getMeta(
    principal: Principal,
    id: string,
    ctx: AuditContext,
  ): Promise<{ id: string; filename: string; contentType: string; sizeBytes: number; spaceId: string; pageId: string | null }> {
    const record = await this.findReadable(principal, id, ctx);
    return {
      id: record.id,
      filename: record.filename,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      spaceId: record.spaceId,
      pageId: record.pageId,
    };
  }

  /** Link an attachment to a page in its space (editor-level, like uploading). */
  async linkToPage(
    principal: Principal,
    id: string,
    pageId: string,
    ctx: AuditContext,
  ): Promise<void> {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundException('Attachment not found.');
    await this.authz.authorize(
      principal,
      Action.AttachmentUpload,
      { type: 'space', spaceId: record.spaceId },
      ctx,
    );
    await this.repo.setPageId(id, pageId);
  }

  /** Fetch bytes for serving. Gated on read access to the owning space. */
  async getBytes(
    principal: Principal,
    id: string,
    ctx: AuditContext,
  ): Promise<{ bytes: Buffer; record: AttachmentRecord }> {
    const record = await this.findReadable(principal, id, ctx);
    const bytes = await this.storage.read(record.storageKey);
    return { bytes, record };
  }

  private async findReadable(
    principal: Principal,
    id: string,
    ctx: AuditContext,
  ): Promise<AttachmentRecord> {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundException('Attachment not found.');
    await this.authz.authorize(
      principal,
      Action.AttachmentRead,
      { type: 'space', spaceId: record.spaceId },
      ctx,
    );
    if (record.scanStatus === 'blocked') {
      throw new NotFoundException('Attachment not available.');
    }
    return record;
  }
}
