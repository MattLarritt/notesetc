import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes and verifies a correct password', async () => {
    const hash = await svc.hash('correct-horse-battery');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await svc.verify(hash, 'correct-horse-battery')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await svc.hash('correct-horse-battery');
    expect(await svc.verify(hash, 'wrong')).toBe(false);
  });

  it('returns false (not throw) for a malformed hash', async () => {
    expect(await svc.verify('not-a-hash', 'whatever')).toBe(false);
  });

  it('recognizes argon2 hashes', () => {
    expect(svc.isHash('$argon2id$v=19$...')).toBe(true);
    expect(svc.isHash('plaintext')).toBe(false);
  });
});
