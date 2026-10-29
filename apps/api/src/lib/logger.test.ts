import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from './logger.js';

describe('log redaction', () => {
  it('removes cookies, auth headers, passwords and tokens', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink);
    log.info({
      req: { headers: { cookie: 'kvb_session=abc', authorization: 'Bearer xyz' } },
      body: { password: 'hunter2hunter2' },
      session: { tokenHash: 'deadbeef' },
    });
    const out = lines.join('');
    for (const secret of ['abc', 'xyz', 'hunter2hunter2', 'deadbeef']) expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
  });
});
