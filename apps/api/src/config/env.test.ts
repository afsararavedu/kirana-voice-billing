import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c.port).toBe(4000);
    expect(c.cookieSecure).toBe(false);
    expect(c.webOrigins).toEqual(['http://localhost:5173']);
  });

  it('defaults to secure cookies in production and refuses to disable them', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).cookieSecure).toBe(true);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it('defaults voice to browser speech and the on-server rules parser (no key needed)', () => {
    expect(loadConfig(base).voice).toEqual({
      speechProvider: 'browser',
      extractor: 'rules',
      anthropic: null,
      rateLimitMax: 30,
    });
  });

  it('checks the Claude extractor configuration at startup', () => {
    const claude = { ...base, VOICE_EXTRACTOR: 'anthropic' };
    expect(() => loadConfig(claude)).toThrow(/ANTHROPIC_API_KEY: required/);
    expect(() =>
      loadConfig({ ...claude, ANTHROPIC_API_KEY: 'sk-test-placeholder', ANTHROPIC_MODEL: 'gpt-4' }),
    ).toThrow(/ANTHROPIC_MODEL/);
    const ok = loadConfig({ ...claude, ANTHROPIC_API_KEY: 'sk-test-placeholder' });
    expect(ok.voice.anthropic).toEqual({
      apiKey: 'sk-test-placeholder',
      model: 'claude-opus-5-5',
      timeoutMs: 15_000,
    });
    expect(() => loadConfig({ ...base, SPEECH_PROVIDER: 'cloud' })).toThrow(/SPEECH_PROVIDER/);
  });

  it('reports invalid fields without leaking values', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://secret-host/db' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain('DATABASE_URL');
      expect(String(e)).not.toContain('secret-host');
    }
  });
});
