import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupTestApp, WEB_ORIGIN, registerAgent } from './helpers.js';

const { app, db } = setupTestApp();
const password = 'a sufficiently long password';

describe('auth', () => {
  it('registers, sets an httpOnly SameSite cookie, and stores only a token hash', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'Owner@Example.in', password, displayName: 'Ravi', uiLanguage: 'te' })
      .expect(201);

    expect(res.body.user).toMatchObject({
      email: 'owner@example.in',
      uiLanguage: 'te',
      speechLocale: 'en-IN',
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/kvb_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const token = cookie.match(/kvb_session=([^;]+)/)![1]!;
    const sessions = await db.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
    expect(sessions[0]!.tokenHash).toHaveLength(64);

    const user = await db.user.findUniqueOrThrow({ where: { email: 'owner@example.in' } });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(await db.auditLog.count({ where: { action: 'user.registered' } })).toBe(1);
  });

  it('rejects duplicate email with 409', async () => {
    const body = { email: 'dup@example.in', password, displayName: 'A' };
    await request(app).post('/api/v1/auth/register').send(body).expect(201);
    const res = await request(app).post('/api/v1/auth/register').send(body).expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input and does not echo the password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', displayName: '' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('short');
  });

  it('logs in, reads /me, logs out and revokes the session server-side', async () => {
    const { email } = await registerAgent(app, 'login');
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    await agent.get('/api/v1/auth/me').expect(200);
    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('gives the same error for unknown email and wrong password', async () => {
    const { email } = await registerAgent(app, 'enum');
    const a = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong password!!' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@example.in', password });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe(b.body.error.code);
  });

  it('rejects an expired session', async () => {
    const { agent } = await registerAgent(app, 'expiry');
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await agent.get('/api/v1/auth/me').expect(401);
    expect(await db.session.count()).toBe(0);
  });

  it('updates language preferences independently', async () => {
    const { agent } = await registerAgent(app, 'prefs');
    const res = await agent
      .patch('/api/v1/auth/me/preferences')
      .send({ uiLanguage: 'ur', speechLocale: 'hi-IN' })
      .expect(200);
    expect(res.body.user).toMatchObject({ uiLanguage: 'ur', speechLocale: 'hi-IN' });
    await agent.patch('/api/v1/auth/me/preferences').send({ speechLocale: 'fr-FR' }).expect(400);
  });

  it('blocks state-changing requests from a foreign Origin', async () => {
    const { agent } = await registerAgent(app, 'csrf');
    await agent.post('/api/v1/stores').set('Origin', 'https://evil.example').send({ name: 'X' }).expect(403);
    await agent.post('/api/v1/stores').set('Origin', WEB_ORIGIN).send({ name: 'X' }).expect(201);
  });

  it('rejects oversized and malformed bodies safely', async () => {
    const big = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.in', password: 'x'.repeat(200_000) }));
    expect(big.status).toBe(413);
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MALFORMED_JSON');
  });
});

describe('auth rate limit', () => {
  const limited = setupTestApp({ AUTH_RATE_LIMIT_MAX: '3' });

  it('returns 429 after too many login attempts', async () => {
    const attempt = () =>
      request(limited.app)
        .post('/api/v1/auth/login')
        .send({ email: 'x@example.in', password: 'whatever pw' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const res = await attempt();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
