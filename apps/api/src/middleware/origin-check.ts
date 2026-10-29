import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence-in-depth alongside SameSite=Lax cookies: browsers always send Origin on
 * cross-site state-changing requests, so reject any Origin not on the allowlist.
 * Requests without Origin (curl, server-to-server) are allowed; they carry no ambient browser cookies.
 */
export function originCheck(allowed: readonly string[]): RequestHandler {
  const allow = new Set(allowed);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !allow.has(origin)) return next(new AppError(403, 'BAD_ORIGIN', 'Origin not allowed'));
    next();
  };
}
