import { describe, expect, it } from 'vitest';
import { createProduct, createStore, newIdemKey, registerAgent, setupTestApp } from './helpers.js';
import { quote, salesUrl, sell } from './sales-helpers.js';

const { app, db } = setupTestApp();

async function shop() {
  const owner = await registerAgent(app, 'owner');
  const store = await createStore(owner.agent);
  // MRP-style, 5% GST included: 2 x 52.50 = 105.00 -> taxable 100.00 + GST 5.00
  const dal = await createProduct(owner.agent, store.id, {
    name: 'Toor Dal',
    unit: 'KG',
    sellingPrice: '52.50',
    taxRate: '5',
    openingStock: '10',
  });
  // Tax-exclusive, 18%: 1 x 100.00 -> 118.00
  const oil = await createProduct(owner.agent, store.id, {
    name: 'Oil',
    unit: 'PIECE',
    sellingPrice: '100',
    taxRate: '18',
    priceIncludesTax: false,
    openingStock: '5',
  });
  return { ...owner, store, dal, oil };
}

const stockOf = async (id: string) =>
  (await db.product.findUniqueOrThrow({ where: { id } })).stockQuantity.toFixed(3);

describe('quote', () => {
  it('prices from the catalog with GST per line and exact totals', async () => {
    const { agent, store, dal, oil } = await shop();
    const q = await quote(agent, store.id, [
      { productId: dal.id, quantity: '2' },
      { productId: oil.id, quantity: '1' },
    ]);
    expect(q.lines.map((l) => [l.lineTotal, l.taxAmount])).toEqual([
      ['105.00', '5.00'],
      ['118.00', '18.00'],
    ]);
    expect(q.totals).toEqual({
      taxableTotal: '200.00',
      taxTotal: '23.00',
      discountTotal: '0.00',
      grandTotal: '223.00',
    });
    expect(q.shortages).toEqual([]);
    expect(await db.sale.count()).toBe(0); // read-only
  });

  it('reports shortages summed across duplicate lines', async () => {
    const { agent, store, oil } = await shop();
    const q = await quote(agent, store.id, [
      { productId: oil.id, quantity: '3' },
      { productId: oil.id, quantity: '3' },
    ]);
    expect(q.shortages).toEqual([{ productId: oil.id, requested: '6.000', available: '5.000' }]);
  });

  it('ignores any client-supplied price fields', async () => {
    const { agent, store, dal } = await shop();
    await agent
      .post(`${salesUrl(store.id)}/quote`)
      .send({ items: [{ productId: dal.id, quantity: '1', unitPrice: '0.01' }] })
      .expect(400); // strict schema: there is no such field
  });
});

describe('finalize', () => {
  it('writes sale, lines, payment, stock movements and audit in one go', async () => {
    const { agent, store, dal, oil, user } = await shop();
    const res = await sell(
      agent,
      store.id,
      [
        { productId: dal.id, quantity: '2' },
        { productId: oil.id, quantity: '1' },
      ],
      { payments: [{ method: 'CASH', amount: '223.00', tendered: '500' }] },
    );
    expect(res.status).toBe(201);
    const sale = res.body.sale;
    expect(sale).toMatchObject({
      number: 1,
      status: 'COMPLETED',
      grandTotal: '223.00',
      taxTotal: '23.00',
      refundedTotal: '0.00',
      createdBy: { id: user.id },
      payments: [{ method: 'CASH', amount: '223.00', tendered: '500.00', change: '277.00' }],
    });
    expect(sale.items).toHaveLength(2);
    expect(await stockOf(dal.id)).toBe('8.000');
    expect(await stockOf(oil.id)).toBe('4.000');
    const moves = await db.inventoryMovement.findMany({ where: { saleId: sale.id } });
    expect(moves.map((m) => m.quantityDelta.toFixed(3)).sort()).toEqual(['-1.000', '-2.000']);
    expect(await db.auditLog.count({ where: { action: 'sale.finalized', entityId: sale.id } })).toBe(1);
  });

  it('snapshots the product so later price edits never change past bills', async () => {
    const { agent, store, dal } = await shop();
    const sale = (await sell(agent, store.id, [{ productId: dal.id, quantity: '1' }])).body.sale;
    await agent
      .patch(`/api/v1/stores/${store.id}/products/${dal.id}`)
      .send({ sellingPrice: '99', name: 'X' });
    const again = await agent.get(`${salesUrl(store.id)}/${sale.id}`).expect(200);
    expect(again.body.sale.items[0]).toMatchObject({
      productName: 'Toor Dal',
      unitPrice: '52.50',
      lineTotal: '52.50',
    });
  });

  it('refuses to charge a different total than the one shown (TOTAL_CHANGED)', async () => {
    const { agent, store, dal } = await shop();
    const items = [{ productId: dal.id, quantity: '1' }];
    const shown = (await quote(agent, store.id, items)).totals.grandTotal;
    await agent
      .patch(`/api/v1/stores/${store.id}/products/${dal.id}`)
      .send({ sellingPrice: '60' })
      .expect(200);
    const res = await sell(agent, store.id, items, { expected: shown });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOTAL_CHANGED');
    expect(res.body.error.details.quote.totals.grandTotal).toBe('60.00');
    expect(await db.sale.count()).toBe(0);
  });

  it('blocks overselling and writes nothing', async () => {
    const { agent, store, dal, oil } = await shop();
    const res = await sell(agent, store.id, [
      { productId: dal.id, quantity: '1' },
      { productId: oil.id, quantity: '6' },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { shortages: [{ productId: oil.id, requested: '6.000', available: '5.000' }] },
    });
    expect(await db.sale.count()).toBe(0);
    expect(await stockOf(dal.id)).toBe('10.000');
    const store2 = await db.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(store2.nextSaleNumber).toBe(1); // number not consumed by a failed bill
  });

  it('requires payments to equal the total, and cash tendered to cover it', async () => {
    const { agent, store, oil } = await shop();
    const items = [{ productId: oil.id, quantity: '1' }];
    const short = await sell(agent, store.id, items, { payments: [{ method: 'CASH', amount: '117.99' }] });
    expect(short.status).toBe(422);
    expect(short.body.error).toMatchObject({ code: 'PAYMENT_MISMATCH', details: { grandTotal: '118.00' } });
    const tendered = await sell(agent, store.id, items, {
      payments: [{ method: 'CASH', amount: '118', tendered: '100' }],
    });
    expect(tendered.body.error.code).toBe('TENDERED_TOO_LOW');
    const upiChange = await sell(agent, store.id, items, {
      payments: [{ method: 'UPI', amount: '118', tendered: '200' }],
    });
    expect(upiChange.status).toBe(400);
    const split = await sell(agent, store.id, items, {
      payments: [
        { method: 'CASH', amount: '18' },
        { method: 'UPI', amount: '100.00' },
      ],
    });
    expect(split.status).toBe(201);
    expect(split.body.sale.payments).toHaveLength(2);
  });

  it('discounts: managers may give them (applied before GST); cashiers may not', async () => {
    const { agent, store, oil } = await shop();
    const ok = await sell(agent, store.id, [{ productId: oil.id, quantity: '1', discount: '10' }]);
    expect(ok.status).toBe(201);
    expect(ok.body.sale).toMatchObject({ discountTotal: '10.00', taxTotal: '16.20', grandTotal: '106.20' });
    const tooBig = await sell(agent, store.id, [{ productId: oil.id, quantity: '1', discount: '100.01' }], {
      expected: '0.00',
    });
    expect(tooBig.body.error.code).toBe('DISCOUNT_TOO_LARGE');

    const cashier = await registerAgent(app, 'cashier');
    await db.storeMembership.create({
      data: { userId: cashier.user.id, storeId: store.id, role: 'CASHIER' },
    });
    const denied = await cashier.agent
      .post(`${salesUrl(store.id)}/quote`)
      .send({ items: [{ productId: oil.id, quantity: '1', discount: '1' }] });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('DISCOUNT_NOT_ALLOWED');
    // ...but cashiers can bill normally.
    expect((await sell(cashier.agent, store.id, [{ productId: oil.id, quantity: '1' }])).status).toBe(201);
  });

  it('rejects archived products and fractional counts', async () => {
    const { agent, store, dal, oil } = await shop();
    await agent.patch(`/api/v1/stores/${store.id}/products/${dal.id}`).send({ isActive: false });
    expect(
      (await sell(agent, store.id, [{ productId: dal.id, quantity: '1' }], { expected: '1' })).body.error
        .code,
    ).toBe('PRODUCT_INACTIVE');
    expect(
      (await sell(agent, store.id, [{ productId: oil.id, quantity: '1.5' }], { expected: '1' })).body.error
        .code,
    ).toBe('INVALID_QUANTITY_FOR_UNIT');
  });
});

describe('idempotency', () => {
  it('a retried confirm creates one sale and returns the same bill', async () => {
    const { agent, store, dal } = await shop();
    const items = [{ productId: dal.id, quantity: '1' }];
    const key = newIdemKey();
    const a = await sell(agent, store.id, items, { key });
    const b = await sell(agent, store.id, items, { key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.sale.id).toBe(a.body.sale.id);
    expect(await db.sale.count()).toBe(1);
    expect(await stockOf(dal.id)).toBe('9.000');
  });

  it('five simultaneous confirms with one key produce exactly one sale', async () => {
    const { agent, store, dal } = await shop();
    const items = [{ productId: dal.id, quantity: '1' }];
    const key = newIdemKey();
    const results = await Promise.all(Array.from({ length: 5 }, () => sell(agent, store.id, items, { key })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.sale.id)).size).toBe(1);
    expect(await db.sale.count()).toBe(1);
    expect(await stockOf(dal.id)).toBe('9.000');
  });
});

describe('concurrency', () => {
  it('parallel bills get unique, gap-free numbers', async () => {
    const { agent, store, dal } = await shop();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => sell(agent, store.id, [{ productId: dal.id, quantity: '0.5' }])),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.map((r) => r.body.sale.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await stockOf(dal.id)).toBe('6.000');
  });

  it('parallel bills cannot oversell the last units', async () => {
    const { agent, store, oil } = await shop(); // 5 in stock
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        sell(agent, store.id, [{ productId: oil.id, quantity: '1' }], { expected: '118.00' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stockOf(oil.id)).toBe('0.000');
  });

  it('bills with products in opposite orders do not deadlock', async () => {
    const { agent, store, dal, oil } = await shop();
    const ab = [
      { productId: dal.id, quantity: '0.5' },
      { productId: oil.id, quantity: '1' },
    ];
    const ba = [...ab].reverse();
    const results = await Promise.all([
      sell(agent, store.id, ab),
      sell(agent, store.id, ba),
      sell(agent, store.id, ab),
      sell(agent, store.id, ba),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
  });
});

describe('billing cross-tenant access attempts', () => {
  it('cannot bill another store’s product, read its sales, or return against them', async () => {
    const a = await shop();
    const b = await shop();
    const saleA = (await sell(a.agent, a.store.id, [{ productId: a.dal.id, quantity: '1' }])).body.sale;

    // B puts A's product into B's own bill.
    const q = await b.agent
      .post(`${salesUrl(b.store.id)}/quote`)
      .send({ items: [{ productId: a.dal.id, quantity: '1' }] });
    expect(q.status).toBe(404);
    expect(q.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(
      (await sell(b.agent, b.store.id, [{ productId: a.dal.id, quantity: '1' }], { expected: '52.50' }))
        .status,
    ).toBe(404);

    // B reads A's sale via A's path and via B's own path.
    await b.agent.get(salesUrl(a.store.id)).expect(404);
    await b.agent.get(`${salesUrl(a.store.id)}/${saleA.id}`).expect(404);
    await b.agent.get(`${salesUrl(b.store.id)}/${saleA.id}`).expect(404);
    expect((await b.agent.get(salesUrl(b.store.id))).body.sales).toEqual([]);

    // B tries to return A's sale through B's store.
    const ret = await b.agent
      .post(`${salesUrl(b.store.id)}/${saleA.id}/returns`)
      .set('Idempotency-Key', newIdemKey())
      .send({ items: [{ saleItemId: saleA.items[0].id, quantity: '1' }], reason: 'x', refundMethod: 'CASH' });
    expect(ret.status).toBe(404);

    expect(await db.sale.count({ where: { storeId: b.store.id } })).toBe(0);
    expect(await db.saleReturn.count()).toBe(0);
    expect(await stockOf(a.dal.id)).toBe('9.000');
  });
});

describe('history is append-only at the database level', () => {
  it('blocks editing or deleting a finalised sale and its lines', async () => {
    const { agent, store, dal } = await shop();
    const sale = (await sell(agent, store.id, [{ productId: dal.id, quantity: '1' }])).body.sale;
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "Sale" SET "grandTotal" = 0, "taxableTotal" = 0, "taxTotal" = 0 WHERE "id" = $1::uuid`,
        sale.id,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(db.saleItem.deleteMany({ where: { saleId: sale.id } })).rejects.toThrow(/append-only/);
    await expect(db.salePayment.deleteMany({ where: { saleId: sale.id } })).rejects.toThrow(/append-only/);
  });

  it('CHECK constraints reject an inconsistent bill even if the API were bypassed', async () => {
    const { store, user } = await shop();
    await expect(
      db.sale.create({
        data: {
          storeId: store.id,
          number: 99,
          fiscalYear: 2026,
          invoiceSeq: 99,
          invoiceNumber: '26-27/99',
          seller: { name: 'x' },
          taxableTotal: '100',
          taxTotal: '5',
          discountTotal: '0',
          grandTotal: '106', // != 100 + 5
          receiptLanguage: 'en',
          createdById: user.id,
        },
      }),
    ).rejects.toThrow(/Sale_grand_total_sum/);
  });
});
