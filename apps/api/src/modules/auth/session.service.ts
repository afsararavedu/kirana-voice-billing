import type { PrismaClient, User } from '@prisma/client';
import type { CookieOptions } from 'express';
import { generateSessionToken, sha256Hex } from '../../lib/crypto.js';

const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

export class SessionService {
  /** `__Host-` prefix pins the cookie to this exact host over HTTPS with Path=/. */
  readonly cookieName: string;

  constructor(
    private readonly db: PrismaClient,
    private readonly ttlMs: number,
    private readonly secure: boolean,
  ) {
    this.cookieName = secure ? '__Host-kvb_session' : 'kvb_session';
  }

  cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/', maxAge: this.ttlMs };
  }

  async create(userId: string, userAgent?: string): Promise<string> {
    const token = generateSessionToken();
    await this.db.session.create({
      data: {
        tokenHash: sha256Hex(token),
        userId,
        expiresAt: new Date(Date.now() + this.ttlMs),
        userAgent: userAgent?.slice(0, 255) ?? null,
      },
    });
    return token;
  }

  async resolve(token: string): Promise<{ user: User; sessionId: string } | null> {
    const session = await this.db.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (!session) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.db.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    if (now - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      await this.db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    }
    return { user: session.user, sessionId: session.id };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
  }
}
