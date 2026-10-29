import { SPEECH_PROVIDERS, VOICE_EXTRACTORS } from '@kirana/shared';
import { z } from 'zod';

/**
 * Claude models this app has been checked against for voice extraction: each accepts structured
 * output (`output_config.format`) and `output_config.effort`. Anything else is refused at startup.
 */
export const ANTHROPIC_VOICE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    WEB_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(168),
    COOKIE_SECURE: bool.optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    // Voice billing (Phase 5); provider choices are explained in apps/api/.env.example.
    SPEECH_PROVIDER: z.enum(SPEECH_PROVIDERS).default('browser'),
    VOICE_EXTRACTOR: z.enum(VOICE_EXTRACTORS).default('rules'),
    ANTHROPIC_API_KEY: z.string().trim().optional(),
    ANTHROPIC_MODEL: z.string().trim().default('claude-opus-5-5'),
    VOICE_LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
    VOICE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  })
  .superRefine((e, ctx) => {
    if (e.VOICE_EXTRACTOR !== 'anthropic') return;
    if (!e.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'required when VOICE_EXTRACTOR=anthropic',
      });
    }
    if (!(ANTHROPIC_VOICE_MODELS as readonly string[]).includes(e.ANTHROPIC_MODEL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_MODEL'],
        message: `must be one of ${ANTHROPIC_VOICE_MODELS.join(', ')} (structured output + effort verified)`,
      });
    }
  })
  .transform((e) => ({
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    webOrigins: e.WEB_ORIGINS,
    sessionTtlMs: e.SESSION_TTL_HOURS * 3_600_000,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    trustProxy: e.TRUST_PROXY,
    rateLimit: { windowMs: e.RATE_LIMIT_WINDOW_MS, max: e.RATE_LIMIT_MAX },
    authRateLimit: { windowMs: e.AUTH_RATE_LIMIT_WINDOW_MS, max: e.AUTH_RATE_LIMIT_MAX },
    voice: {
      speechProvider: e.SPEECH_PROVIDER,
      extractor: e.VOICE_EXTRACTOR,
      anthropic:
        e.VOICE_EXTRACTOR === 'anthropic'
          ? { apiKey: e.ANTHROPIC_API_KEY!, model: e.ANTHROPIC_MODEL, timeoutMs: e.VOICE_LLM_TIMEOUT_MS }
          : null,
      rateLimitMax: e.VOICE_RATE_LIMIT_MAX,
    },
  }))
  .refine((c) => c.nodeEnv !== 'production' || c.cookieSecure, {
    message: 'COOKIE_SECURE cannot be false in production',
  });

export type AppConfig = z.output<typeof envSchema>;

/** Parse and validate configuration; fails fast with field names only (never values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${fields.join('\n  ')}`);
  }
  return result.data;
}
