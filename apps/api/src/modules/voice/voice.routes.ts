import { voiceParseSchema } from '@kirana/shared';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../../middleware/auth.js';
import type { VoiceService } from './voice.service.js';

/** Mounted under `/stores/:storeId/voice`, after `requireStoreMember` has set `req.tenant`. */
export function voiceRouter(voice: VoiceService, maxPerMinute: number): Router {
  const r = Router({ mergeParams: true });

  // Per user: an LLM call costs money and time, so one account cannot flood it.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: maxPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `voice:${req.auth!.user.id}`,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many voice requests' } }),
  });

  // Every member may use voice: it only suggests cart lines; billing rules still apply on confirm.
  r.post('/parse', limiter, async (req, res) => {
    const input = voiceParseSchema.parse(req.body);
    res.json({ result: await voice.parse(req.tenant!.storeId, input) });
  });

  return r;
}

/** `GET /api/v1/voice/config` for any signed-in user: which speech locales and extractor are on. */
export function voiceConfigRouter(voice: VoiceService): Router {
  const r = Router();
  r.get('/config', requireAuth, (_req, res) => {
    res.json({ config: voice.config() });
  });
  return r;
}
