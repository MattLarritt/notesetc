import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NotesEtcRequest } from '../request-context';
import { RateLimiter } from './rate-limiter';

export interface RateLimitOptions {
  /** Distinguishes buckets across routes, e.g. "login". */
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'netc:rate-limit';
/** Decorator: `@RateLimit({ name: 'login', limit: 5, windowMs: 60_000 })`. */
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);

/**
 * Enforces per-IP rate limits on decorated routes. Applied to login and other
 * sensitive endpoints; returns 429 with Retry-After when exceeded.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!opts) return true;

    const req = context.switchToHttp().getRequest<NotesEtcRequest>();
    const ip = req.ip ?? 'unknown';
    const result = this.limiter.hit(`${opts.name}:${ip}`, opts.limit, opts.windowMs);

    if (!result.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests. Please try again later.',
          retryAfterMs: result.retryAfterMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
