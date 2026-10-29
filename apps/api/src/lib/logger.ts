import { pino, type Logger } from 'pino';

/** Paths removed from every log line. Covers headers, request bodies and nested objects. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'token',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  // Voice: customers' words and provider keys never reach the logs.
  'transcript',
  '*.transcript',
  'apiKey',
  '*.apiKey',
  'req.headers["x-api-key"]',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'kirana-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}
