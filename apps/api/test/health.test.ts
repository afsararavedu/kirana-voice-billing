import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupTestApp } from './helpers.js';

const { app, db } = setupTestApp();

describe('health', () => {
  it('reports liveness', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports database readiness', async () => {
    const res = await request(app).get('/api/v1/health/ready').expect(200);
    expect(res.body.database).toBe('ok');
  });

  it('uses a UTF-8 database so Indic and Urdu text round-trips', async () => {
    const enc = await db.$queryRaw<{ server_encoding: string }[]>`SHOW server_encoding`;
    expect(enc[0]?.server_encoding).toBe('UTF8');
    const echo = await db.$queryRaw<{ t: string }[]>`SELECT ${'కంది पप्पु ارہر'}::text AS t`;
    expect(echo[0]?.t).toBe('కంది पप्पु ارہر');
  });

  it('sets security headers and a request id', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
