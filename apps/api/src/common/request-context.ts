import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AuditContext } from '../audit/audit.service';
import type { Principal } from '@notesetc/shared';

/** Fields we attach to the Express request across the pipeline. */
export interface NotesEtcRequest extends Request {
  requestId?: string;
  principal?: Principal;
}

/** Assigns a stable request id (for audit correlation) if absent. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: NotesEtcRequest, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  }
}

/** Extracts audit context (ip / user-agent / request id) from a request. */
export function auditContext(req: NotesEtcRequest): AuditContext {
  return {
    ip: req.ip,
    userAgent: req.header('user-agent') ?? undefined,
    requestId: req.requestId,
  };
}
