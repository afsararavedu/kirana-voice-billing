import type { StoreRole } from '@prisma/client';
import { uuidParam } from '@kirana/shared';
import type { RequestHandler } from 'express';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import type { SessionService } from '../modules/auth/session.service.js';
import type { StoreRepository } from '../modules/stores/store.repository.js';

/** Resolves the session cookie (if any) to `req.auth`. Does not reject anonymous requests. */
export function authenticate(sessions: SessionService): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[sessions.cookieName];
    if (typeof token === 'string' && token.length > 0 && token.length <= 128) {
      const resolved = await sessions.resolve(token);
      if (resolved) req.auth = resolved;
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.auth ? undefined : unauthorized());
};

/**
 * Tenant gate for `/stores/:storeId/*`. Membership is looked up for the authenticated user;
 * a store the user does not belong to is indistinguishable from a store that does not exist.
 */
export function requireStoreMember(stores: StoreRepository): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    const parsed = uuidParam.safeParse(req.params.storeId);
    if (!parsed.success) return next(notFound('Store'));
    const membership = await stores.findMembership(req.auth.user.id, parsed.data);
    if (!membership) return next(notFound('Store'));
    req.tenant = { storeId: membership.storeId, role: membership.role };
    next();
  };
}

export function requireRole(...roles: StoreRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.tenant) return next(unauthorized());
    next(roles.includes(req.tenant.role) ? undefined : forbidden());
  };
}
