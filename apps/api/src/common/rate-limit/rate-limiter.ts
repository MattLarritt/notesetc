import { Injectable } from '@nestjs/common';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Rate-limiter boundary (DI token). The POC uses an in-memory fixed-window
 * counter; production swaps in a Redis-backed implementation without touching
 * callers. Keyed by an arbitrary string (e.g. `login:<ip>`).
 */
export abstract class RateLimiter {
  abstract hit(key: string, limit: number, windowMs: number): RateLimitResult;
}

interface Window {
  count: number;
  resetAt: number;
}

@Injectable()
export class InMemoryRateLimiter extends RateLimiter {
  private readonly windows = new Map<string, Window>();

  hit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      this.sweep(now);
      return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
    }

    existing.count += 1;
    if (existing.count > limit) {
      return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
    }
    return { allowed: true, remaining: limit - existing.count, retryAfterMs: 0 };
  }

  /** Opportunistic cleanup of expired windows to bound memory. */
  private sweep(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [k, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(k);
    }
  }
}
