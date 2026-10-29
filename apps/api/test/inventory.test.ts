import { describe, expect, it } from 'vitest';
import {
  createProduct,
  createStore,
  newIdemKey,
  postMovement,
  registerAgent,
  setupTestApp,
} from './helpers.js';

const { app, db } = setupTestApp();

async function setup(product: Record<string, unknown> = {}) {
  const owner = await registerAgent(app, 'owner');
  const store = await createStore(owner.agent);
  const p = await createProduct(owner.agent, store.id, product);
  const move = (body: object, key?: string) => postMovement(owner.agent, store.id, p.id, body, key);
  return { ...owner, store, product: p, move };
}

async function ledgerMatchesCache(productId: string) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const agg = await db.inventoryMovement.aggregate({ where: { productId }, _sum: { quantityDelta: true } });
  return { cached: p.stockQuantity.toFixed(3), ledger: (agg._sum.quantityDelta ?? 0).toString() };
}

describe('stock movements', () => {
  it('receives, damages and counts with exact decimal balances', async () => {
    const { product, move } = await setup({ openingStock: '10' });

    const r1 = await move({ type: 'RECEIVE', quantity: '2.125', note: 'Supplier A' }).expect(201);
    expect(r1.body.movement).toMatchObject({
      type: 'RECEIVE',
      quantityDelta: '2.125',
      balanceAfter: '12.125',
    });

    const r2 = await move({ type: 'DAMAGE', quantity: '0.125' }).expect(201);
    expect(r2.body.movement).toMatchObject({ quantityDelta: '-0.125', balanceAfter: '12.000' });

    const r3 = await move({ type: 'COUNT', countedQuantity: '11.5' }).expect(201);
    expect(r3.body.movement).toMatchObject({
      type: 'COUNT',
      quantityDelta: '-0.500',
      balanceAfter: '11.500', // the counted quantity
      note: null, // no server-generated (English) text in the ledger
    });
    expect(r3.body.product.stockQuantity).toBe('11.500');

    const { cached, ledger } = await ledgerMatchesCache(product.id);
    expect(Number(ledger)).toBe(11.5);
    expect(cached).toBe('11.500');
  });

  it('a count that matches the books succeeds without a ledger entry', async () => {
    const { product, move } = await setup({ openingStock: '3' });
    const res = await move({ type: 'COUNT', countedQuantity: '3' }).expect(200);
    expect(res.body.movement).toBeNull();
    expect(await db.inventoryMovement.count({ where: { productId: product.id } })).toBe(1);
  });

  it('refuses to take stock below zero and changes nothing', async () => {
    const { product, move } = await setup({ openingStock: '1' });
    const res = await move({ type: 'EXPIRY', quantity: '1.001' }).expect(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { available: '1.000' } });
    await move({ type: 'ADJUST', quantityDelta: '-2', note: 'x' }).expect(409);
    expect((await ledgerMatchesCache(product.id)).cached).toBe('1.000');
  });

  it('validates quantities against the product unit and rejects zero', async () => {
    const { move } = await setup({ unit: 'PIECE', sellingPrice: '10', openingStock: '5' });
    expect((await move({ type: 'RECEIVE', quantity: '1.5' }).expect(400)).body.error.code).toBe(
      'INVALID_QUANTITY_FOR_UNIT',
    );
    expect((await move({ type: 'RECEIVE', quantity: '0' }).expect(400)).body.error.code).toBe(
      'QUANTITY_MUST_BE_POSITIVE',
    );
    await move({ type: 'RECEIVE', quantity: 2 }).expect(400); // JSON number
  });

  it('lists the ledger newest first, with audit records for every movement', async () => {
    const { agent, store, product, move } = await setup({ openingStock: '1' });
    await move({ type: 'RECEIVE', quantity: '4' }).expect(201);
    await move({ type: 'ADJUST', quantityDelta: '-1', note: 'Spilled' }).expect(201);
    const res = await agent
      .get(`/api/v1/stores/${store.id}/products/${product.id}/stock-movements`)
      .expect(200);
    expect(res.body.movements.map((m: { type: string }) => m.type)).toEqual(['ADJUST', 'RECEIVE', 'OPENING']);
    expect(await db.auditLog.count({ where: { action: { startsWith: 'stock.' } } })).toBe(2);
  });
});

describe('idempotency', () => {
  it('requires an Idempotency-Key', async () => {
    const { agent, store, product } = await setup();
    const res = await agent
      .post(`/api/v1/stores/${store.id}/products/${product.id}/stock-movements`)
      .send({ type: 'RECEIVE', quantity: '1' })
      .expect(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('a retried request is applied once and replays the original response', async () => {
    const { product, move } = await setup({ openingStock: '0' });
    const key = newIdemKey();
    const first = await move({ type: 'RECEIVE', quantity: '5' }, key).expect(201);
    const retry = await move({ type: 'RECEIVE', quantity: '5' }, key).expect(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect((await ledgerMatchesCache(product.id)).cached).toBe('5.000');
  });

  it('concurrent duplicates of the same key still apply once', async () => {
    const { product, move } = await setup({ openingStock: '0' });
    const key = newIdemKey();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => move({ type: 'RECEIVE', quantity: '2' }, key)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await db.inventoryMovement.count({ where: { productId: product.id } })).toBe(1);
    expect((await ledgerMatchesCache(product.id)).cached).toBe('2.000');
  });

  it('rejects reuse of a key with a different payload', async () => {
    const { move } = await setup();
    const key = newIdemKey();
    await move({ type: 'RECEIVE', quantity: '1' }, key).expect(201);
    const res = await move({ type: 'RECEIVE', quantity: '9' }, key).expect(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('concurrency', () => {
  it('parallel movements serialise on the row lock: no lost updates, ledger equals cache', async () => {
    const { product, move } = await setup({ openingStock: '10' });
    const ops = [
      ...Array.from({ length: 10 }, () => move({ type: 'RECEIVE', quantity: '1.5' })),
      ...Array.from({ length: 10 }, () => move({ type: 'DAMAGE', quantity: '0.5' })),
    ];
    const results = await Promise.all(ops);
    expect(results.map((r) => r.status).every((s) => s === 201)).toBe(true);

    const { cached } = await ledgerMatchesCache(product.id);
    expect(cached).toBe('20.000'); // 10 + 15 − 5
    const ledger = await db.inventoryMovement.findMany({
      where: { productId: product.id },
      orderBy: { seq: 'asc' },
    });
    // Each balanceAfter is the previous balance plus its own delta — a consistent chain.
    let running = ledger[0]!.balanceAfter;
    for (const m of ledger.slice(1)) {
      running = running.plus(m.quantityDelta);
      expect(m.balanceAfter.equals(running)).toBe(true);
    }
  });

  it('parallel withdrawals cannot overdraw stock', async () => {
    const { product, move } = await setup({ unit: 'PIECE', sellingPrice: '10', openingStock: '3' });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => move({ type: 'DAMAGE', quantity: '1' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await ledgerMatchesCache(product.id)).cached).toBe('0.000');
  });
});

describe('append-only history (database level)', () => {
  it('blocks UPDATE and DELETE on the ledger and audit log', async () => {
    const { product } = await setup({ openingStock: '1' });
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "InventoryMovement" SET "quantityDelta" = 100 WHERE "productId" = $1::uuid`,
        product.id,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(db.inventoryMovement.deleteMany({ where: { productId: product.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('CHECK constraints reject negative stock even if application code were bypassed', async () => {
    const { product } = await setup();
    await expect(
      db.$executeRawUnsafe(`UPDATE "Product" SET "stockQuantity" = -1 WHERE "id" = $1::uuid`, product.id),
    ).rejects.toThrow(/stockQuantity_nonneg/);
  });
});
