import { randomBytes } from 'crypto';

// Base62 alphabet. Codes are opaque, case-sensitive, and safe in a URL path with
// no escaping. 7 chars ~= 62^7 (3.5e12) of space, so collisions are vanishingly
// rare even before the DB's unique index has the final say.
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Generate a short, URL-friendly base62 code for a page's public handle. */
export function generateShortId(length = 7): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % 62];
  return out;
}
