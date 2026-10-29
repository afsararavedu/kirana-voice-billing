import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLen: 64, saltLen: 16 };

function scryptAsync(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const opts = (N: number, r: number, p: number): ScryptOptions => ({ N, r, p, maxmem: 128 * N * r * p * 2 });

/** Format: scrypt$N$r$p$saltB64$hashB64 — parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltLen);
  const key = await scryptAsync(password, salt, SCRYPT.keyLen, opts(SCRYPT.N, SCRYPT.r, SCRYPT.p));
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scryptAsync(
    password,
    Buffer.from(saltB64, 'base64'),
    expected.length,
    opts(Number(n), Number(r), Number(p)),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A valid hash of a random password, used to equalise timing when the email is unknown. */
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString('hex'));

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
