import { loginSchema, registerSchema, updatePreferencesSchema } from '@kirana/shared';
import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthService } from './auth.service.js';
import type { SessionService } from './session.service.js';
import { toUserDto } from './user.repository.js';

export function authRouter(auth: AuthService, sessions: SessionService, authLimiter: RequestHandler): Router {
  const r = Router();

  r.post('/register', authLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await auth.register(input);
    const token = await sessions.create(user.id, req.get('user-agent'));
    res.cookie(sessions.cookieName, token, sessions.cookieOptions());
    res.status(201).json({ user: toUserDto(user) });
  });

  r.post('/login', authLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await auth.login(input);
    // Rotate: any previous session on this browser is dropped to prevent fixation.
    if (req.auth) await sessions.revoke(req.auth.sessionId);
    const token = await sessions.create(user.id, req.get('user-agent'));
    res.cookie(sessions.cookieName, token, sessions.cookieOptions());
    res.json({ user: toUserDto(user) });
  });

  r.post('/logout', async (req, res) => {
    if (req.auth) await sessions.revoke(req.auth.sessionId);
    const { maxAge: _maxAge, ...opts } = sessions.cookieOptions();
    res.clearCookie(sessions.cookieName, opts);
    res.status(204).end();
  });

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: toUserDto(req.auth!.user) });
  });

  r.patch('/me/preferences', requireAuth, async (req, res) => {
    const input = updatePreferencesSchema.parse(req.body);
    const user = await auth.updatePreferences(req.auth!.user.id, input);
    res.json({ user: toUserDto(user) });
  });

  return r;
}
