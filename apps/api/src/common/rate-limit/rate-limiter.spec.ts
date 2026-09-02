import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from './rate-limiter';

describe('InMemoryRateLimiter', () => {
  it('allows up to the limit then blocks', () => {
    const rl = new InMemoryRateLimiter();
    const key = 'login:1.2.3.4';
    for (let i = 0; i < 3; i++) {
      expect(rl.hit(key, 3, 60_000).allowed).toBe(true);
    }
    const blocked = rl.hit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('isolates buckets by key', () => {
    const rl = new InMemoryRateLimiter();
    rl.hit('login:a', 1, 60_000);
    expect(rl.hit('login:a', 1, 60_000).allowed).toBe(false);
    expect(rl.hit('login:b', 1, 60_000).allowed).toBe(true);
  });

  it('resets after the window elapses', () => {
    vi.useFakeTimers();
    try {
      const rl = new InMemoryRateLimiter();
      expect(rl.hit('k', 1, 1000).allowed).toBe(true);
      expect(rl.hit('k', 1, 1000).allowed).toBe(false);
      vi.advanceTimersByTime(1001); // window elapses deterministically
      expect(rl.hit('k', 1, 1000).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
