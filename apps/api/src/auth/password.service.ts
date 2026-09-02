import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing for local accounts. Uses argon2id with memory-hard params
 * (OWASP-aligned). The salt is generated and embedded by argon2 automatically.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, this.options);
  }

  /** Constant-time verify. Returns false on any malformed hash rather than throwing. */
  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  /** True if a string looks like an argon2 encoded hash (for breakglass config). */
  isHash(value: string): boolean {
    return value.startsWith('$argon2');
  }
}
