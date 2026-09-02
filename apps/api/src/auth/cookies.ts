import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE = 'netc_session';

/** Cookie options for the session token: httpOnly + Secure + SameSite=Lax. */
export function sessionCookieOptions(secure: boolean, expires: Date): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires,
  };
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
}
