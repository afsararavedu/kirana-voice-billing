import { describe, expect, it } from 'vitest';
import { generateSessionToken, hashPassword, sha256Hex, verifyPassword } from './crypto.js';

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('session tokens', () => {
  it('are 256-bit url-safe and hashed to 64 hex chars', () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
