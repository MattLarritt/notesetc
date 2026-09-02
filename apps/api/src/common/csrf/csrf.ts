import { randomBytes } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export const CSRF_COOKIE = 'netc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Issues a CSRF token and sets the (JS-readable) double-submit cookie. */
export function issueCsrfToken(res: Response, secure: boolean): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // must be readable by the client to echo in the header
    secure,
    sameSite: 'lax',
    path: '/',
  });
  return token;
}

/**
 * Double-submit CSRF protection for cookie-authenticated, state-changing
 * requests. Bearer-token (API/MCP) requests carry no ambient cookie auth and are
 * therefore exempt. Safe methods pass through.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { cookies?: Record<string, string> }>();

    if (SAFE_METHODS.has(req.method)) return true;

    const auth = req.header('authorization');
    if (auth?.toLowerCase().startsWith('bearer ')) return true;

    const headerToken = req.header(CSRF_HEADER);
    const cookieToken = req.cookies?.[CSRF_COOKIE];

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      throw new ForbiddenException('Invalid or missing CSRF token.');
    }
    return true;
  }
}
