import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createStore, registerAgent, setupTestApp } from './helpers.js';

const { app, db } = setupTestApp();

describe('stores and tenant isolation', () => {
  it('creates a store with the creator as OWNER and an audit record, atomically', async () => {
    const { agent, user } = await registerAgent(app, 'owner');
    const store = await createStore(agent);
    expect(store.role).toBe('OWNER');

    const m = await db.storeMembership.findUniqueOrThrow({
      where: { userId_storeId: { userId: user.id, storeId: store.id } },
    });
    expect(m.role).toBe('OWNER');
    expect(await db.auditLog.count({ where: { storeId: store.id, action: 'store.created' } })).toBe(1);
  });

  it('ignores client-supplied owner/tenant fields on create', async () => {
    const a = await registerAgent(app, 'a');
    const b = await registerAgent(app, 'b');
    const res = await a.agent
      .post('/api/v1/stores')
      .send({ name: 'Mine', ownerId: b.user.id, userId: b.user.id })
      .expect(201);
    expect(await db.storeMembership.count({ where: { storeId: res.body.store.id, userId: b.user.id } })).toBe(
      0,
    );
  });

  it('lists only the caller’s stores', async () => {
    const a = await registerAgent(app, 'a');
    const b = await registerAgent(app, 'b');
    await createStore(a.agent, 'A store');
    await createStore(b.agent, 'B store');
    const res = await a.agent.get('/api/v1/stores').expect(200);
    expect(res.body.stores.map((s: { name: string }) => s.name)).toEqual(['A store']);
  });

  describe('cross-tenant access attempts', () => {
    async function twoTenants() {
      const a = await registerAgent(app, 'tenantA');
      const b = await registerAgent(app, 'tenantB');
      const storeA = await createStore(a.agent, 'A store');
      return { a, b, storeA };
    }

    it('cannot read another tenant’s store (404, same as nonexistent)', async () => {
      const { b, storeA } = await twoTenants();
      const foreign = await b.agent.get(`/api/v1/stores/${storeA.id}`).expect(404);
      const missing = await b.agent.get(`/api/v1/stores/${randomUUID()}`).expect(404);
      expect(foreign.body.error.code).toBe(missing.body.error.code);
      expect(foreign.body.error.message).toBe(missing.body.error.message);
    });

    it('cannot update another tenant’s store, and nothing changes', async () => {
      const { b, storeA } = await twoTenants();
      await b.agent.patch(`/api/v1/stores/${storeA.id}`).send({ name: 'pwned' }).expect(404);
      const s = await db.store.findUniqueOrThrow({ where: { id: storeA.id } });
      expect(s.name).toBe('A store');
      expect(await db.auditLog.count({ where: { action: 'store.updated' } })).toBe(0);
    });

    it('cannot read another tenant’s audit log', async () => {
      const { b, storeA } = await twoTenants();
      await b.agent.get(`/api/v1/stores/${storeA.id}/audit-logs`).expect(404);
    });

    it('rejects unauthenticated access and malformed ids', async () => {
      const { a, storeA } = await twoTenants();
      await request(app).get(`/api/v1/stores/${storeA.id}`).expect(401);
      await request(app).get('/api/v1/stores').expect(401);
      await a.agent.get('/api/v1/stores/not-a-uuid').expect(404);
      await a.agent.get(`/api/v1/stores/${storeA.id}'%20OR%201=1`).expect(404);
    });
  });

  describe('roles within a tenant', () => {
    it('lets a CASHIER read but not update the store', async () => {
      const owner = await registerAgent(app, 'owner');
      const cashier = await registerAgent(app, 'cashier');
      const store = await createStore(owner.agent);
      await db.storeMembership.create({
        data: { userId: cashier.user.id, storeId: store.id, role: 'CASHIER' },
      });

      const res = await cashier.agent.get(`/api/v1/stores/${store.id}`).expect(200);
      expect(res.body.store.role).toBe('CASHIER');
      await cashier.agent.patch(`/api/v1/stores/${store.id}`).send({ name: 'x' }).expect(403);
      await cashier.agent.get(`/api/v1/stores/${store.id}/audit-logs`).expect(403);
    });
  });

  it('owner update writes an audit record with before/after', async () => {
    const { agent } = await registerAgent(app, 'owner');
    const store = await createStore(agent, 'Old name');
    await agent
      .patch(`/api/v1/stores/${store.id}`)
      .send({ name: 'New name', receiptLanguage: 'te' })
      .expect(200);
    const res = await agent.get(`/api/v1/stores/${store.id}/audit-logs`).expect(200);
    const updated = res.body.entries.find((e: { action: string }) => e.action === 'store.updated');
    expect(updated.metadata).toEqual({
      name: { from: 'Old name', to: 'New name' },
      receiptLanguage: { from: 'en', to: 'te' },
    });
  });
});
