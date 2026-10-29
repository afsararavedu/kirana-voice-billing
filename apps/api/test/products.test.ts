import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProduct, createStore, postMovement, registerAgent, setupTestApp } from './helpers.js';

const { app, db } = setupTestApp();

async function ownerWithStore() {
  const owner = await registerAgent(app, 'owner');
  const store = await createStore(owner.agent);
  return { ...owner, store, base: `/api/v1/stores/${store.id}/products` };
}

describe('products', () => {
  it('creates a product with exact decimals, opening stock ledger entry, aliases and audit', async () => {
    const { agent, store, base } = await ownerWithStore();
    const res = await agent
      .post(base)
      .send({
        name: 'Toor Dal',
        localNames: { hi: 'अरहर दाल', te: 'కంది పప్పు', ur: 'ارہر دال' },
        aliases: ['tuvar', 'kandi pappu'],
        unit: 'KG',
        sellingPrice: '140.5',
        taxRate: '5',
        openingStock: '12.250',
        lowStockThreshold: '2',
      })
      .expect(201);

    expect(res.body.product).toMatchObject({
      sellingPrice: '140.50',
      taxRate: '5.00',
      stockQuantity: '12.250',
      lowStockThreshold: '2.000',
      priceIncludesTax: true,
      aliases: ['tuvar', 'kandi pappu'],
      localNames: { hi: 'अरहर दाल', te: 'కంది పప్పు', ur: 'ارہر دال' },
    });

    const id = res.body.product.id;
    const ledger = await db.inventoryMovement.findMany({ where: { productId: id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'OPENING' });
    expect(ledger[0]!.quantityDelta.toFixed(3)).toBe('12.250');
    expect(await db.productAlias.count({ where: { productId: id } })).toBe(6);
    expect(await db.auditLog.count({ where: { storeId: store.id, action: 'product.created' } })).toBe(1);
  });

  it('rejects JSON numbers, excess precision and fractional counts for countable units', async () => {
    const { agent, base } = await ownerWithStore();
    await agent.post(base).send({ name: 'X', unit: 'KG', sellingPrice: 12.5 }).expect(400);
    await agent.post(base).send({ name: 'X', unit: 'KG', sellingPrice: '12.505' }).expect(400);
    await agent
      .post(base)
      .send({ name: 'X', unit: 'PIECE', sellingPrice: '10', openingStock: '1.5' })
      .expect(400);
    await agent.post(base).send({ name: 'X', unit: 'KG', sellingPrice: '10', taxRate: '101' }).expect(400);
    expect(await db.product.count()).toBe(0);
  });

  it('searches by any name in any script, normalised', async () => {
    const { agent, store, base } = await ownerWithStore();
    await createProduct(agent, store.id, { name: 'Toor Dal', localNames: { te: 'కంది పప్పు' } });
    await createProduct(agent, store.id, {
      name: 'Sugar',
      localNames: { hi: 'चीनी', ur: 'چینی' },
      unit: 'KG',
    });

    const names = async (q: string) =>
      (await agent.get(base).query({ q }).expect(200)).body.products.map((p: { name: string }) => p.name);
    expect(await names('కంది')).toEqual(['Toor Dal']);
    expect(await names('चीनी')).toEqual(['Sugar']);
    expect(await names('چینی')).toEqual(['Sugar']);
    expect(await names('  TOOR-dal ')).toEqual(['Toor Dal']);
    expect(await names('100%_')).toEqual([]); // LIKE wildcards are neutralised
  });

  it('paginates with a cursor', async () => {
    const { agent, store, base } = await ownerWithStore();
    for (const n of ['A', 'B', 'C']) await createProduct(agent, store.id, { name: n });
    const p1 = (await agent.get(base).query({ limit: 2 }).expect(200)).body;
    expect(p1.products.map((p: { name: string }) => p.name)).toEqual(['A', 'B']);
    const p2 = (await agent.get(base).query({ limit: 2, cursor: p1.nextCursor }).expect(200)).body;
    expect(p2.products.map((p: { name: string }) => p.name)).toEqual(['C']);
    expect(p2.nextCursor).toBeNull();
  });

  it('enforces unique SKU per store but allows the same SKU in another store', async () => {
    const { agent, store } = await ownerWithStore();
    await createProduct(agent, store.id, { sku: 'DAL-1' });
    const dup = await agent
      .post(`/api/v1/stores/${store.id}/products`)
      .send({ name: 'Other', unit: 'KG', sellingPrice: '1', sku: 'DAL-1' })
      .expect(409);
    expect(dup.body.error.code).toBe('SKU_TAKEN');

    const other = await ownerWithStore();
    await createProduct(other.agent, other.store.id, { sku: 'DAL-1' });
  });

  it('updates price with an audit trail, rebuilds aliases, and never accepts unit or stock changes', async () => {
    const { agent, store, base } = await ownerWithStore();
    const p = await createProduct(agent, store.id, { aliases: ['tuvar'] });
    const res = await agent
      .patch(`${base}/${p.id}`)
      .send({ sellingPrice: '150', aliases: ['arhar'] })
      .expect(200);
    expect(res.body.product).toMatchObject({ sellingPrice: '150.00', aliases: ['arhar'] });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'product.updated', entityId: p.id },
    });
    expect(audit.metadata).toEqual({
      sellingPrice: { from: '140.00', to: '150.00' },
      aliases: { from: ['tuvar'], to: ['arhar'] },
    });

    await agent.patch(`${base}/${p.id}`).send({ unit: 'G' }).expect(400);
    await agent.patch(`${base}/${p.id}`).send({ stockQuantity: '999' }).expect(400);
    expect((await agent.get(base).query({ q: 'tuvar' })).body.products).toHaveLength(0);
  });

  it('archives instead of deleting', async () => {
    const { agent, store, base } = await ownerWithStore();
    const p = await createProduct(agent, store.id);
    await agent.patch(`${base}/${p.id}`).send({ isActive: false }).expect(200);
    expect((await agent.get(base)).body.products).toHaveLength(0);
    expect((await agent.get(base).query({ includeInactive: 'true' })).body.products).toHaveLength(1);
    await agent.delete(`${base}/${p.id}`).expect(404);
  });

  it('lets a CASHIER read the catalog but not change it', async () => {
    const { agent, store, base } = await ownerWithStore();
    const p = await createProduct(agent, store.id);
    const cashier = await registerAgent(app, 'cashier');
    await db.storeMembership.create({
      data: { userId: cashier.user.id, storeId: store.id, role: 'CASHIER' },
    });

    await cashier.agent.get(base).expect(200);
    await cashier.agent.get(`${base}/${p.id}`).expect(200);
    await cashier.agent.post(base).send({ name: 'X', unit: 'KG', sellingPrice: '1' }).expect(403);
    await cashier.agent.patch(`${base}/${p.id}`).send({ sellingPrice: '1' }).expect(403);
    await postMovement(cashier.agent, store.id, p.id, { type: 'RECEIVE', quantity: '1' }).expect(403);
    await cashier.agent.post(`${base}/import`).send({ csv: 'name,unit,selling_price\nX,KG,1' }).expect(403);
  });
});

describe('catalog cross-tenant access attempts', () => {
  async function twoTenants() {
    const a = await ownerWithStore();
    const b = await ownerWithStore();
    const productA = await createProduct(a.agent, a.store.id, {
      name: 'Secret Dal',
      sku: 'A-1',
      openingStock: '5',
    });
    return { a, b, productA };
  }

  it('B cannot list, read, update or see the ledger of A’s products via A’s store path', async () => {
    const { a, b, productA } = await twoTenants();
    await b.agent.get(a.base).expect(404);
    await b.agent.get(`${a.base}/${productA.id}`).expect(404);
    await b.agent.patch(`${a.base}/${productA.id}`).send({ sellingPrice: '1' }).expect(404);
    await b.agent.get(`${a.base}/${productA.id}/stock-movements`).expect(404);
    await postMovement(b.agent, a.store.id, productA.id, { type: 'DAMAGE', quantity: '5' }).expect(404);
    await b.agent.post(`${a.base}/import`).send({ csv: 'name,unit,selling_price\nX,KG,1' }).expect(404);
  });

  it('B cannot reach A’s product through B’s own store path (product id swapping)', async () => {
    const { a, b, productA } = await twoTenants();
    const read = await b.agent.get(`${b.base}/${productA.id}`).expect(404);
    const missing = await b.agent.get(`${b.base}/${randomUUID()}`).expect(404);
    expect(read.body.error).toMatchObject({
      code: missing.body.error.code,
      message: missing.body.error.message,
    });
    await b.agent.patch(`${b.base}/${productA.id}`).send({ sellingPrice: '1' }).expect(404);
    await b.agent.get(`${b.base}/${productA.id}/stock-movements`).expect(404);
    await postMovement(b.agent, b.store.id, productA.id, { type: 'DAMAGE', quantity: '5' }).expect(404);

    const after = await db.product.findUniqueOrThrow({ where: { id: productA.id } });
    expect(after.sellingPrice.toFixed(2)).toBe('140.00');
    expect(after.stockQuantity.toFixed(3)).toBe('5.000');
    expect(await db.inventoryMovement.count({ where: { productId: productA.id } })).toBe(1);
    void a;
  });

  it('search in B’s store never returns A’s products', async () => {
    const { b } = await twoTenants();
    expect((await b.agent.get(b.base).query({ q: 'secret' })).body.products).toEqual([]);
  });

  it('the database itself rejects a movement that points at another store’s product', async () => {
    const { b, productA } = await twoTenants();
    await expect(
      db.inventoryMovement.create({
        data: {
          storeId: b.store.id,
          productId: productA.id,
          type: 'RECEIVE',
          quantityDelta: '1',
          balanceAfter: '1',
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });
});
