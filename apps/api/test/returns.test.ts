import { describe, expect, it } from 'vitest';
import { createProduct, createStore, newIdemKey, registerAgent, setupTestApp } from './helpers.js';
import { returnItems, salesUrl, sell } from './sales-helpers.js';

const { app, db } = setupTestApp();

async function soldBill() {
  const owner = await registerAgent(app, 'owner');
  const store = await createStore(owner.agent);
  // 3 soaps at ₹3.33 with 18% GST inside. (Uneven-split drift is covered in pricing.test.ts.)
  const soap = await createProduct(owner.agent, store.id, {
    name: 'Soap',
    unit: 'PIECE',
    sellingPrice: '3.33',
    taxRate: '18',
    openingStock: '10',
  });
  const rice = await createProduct(owner.agent, store.id, {
    name: 'Rice',
    unit: 'KG',
    sellingPrice: '62',
    openingStock: '20',
  });
  const res = await sell(owner.agent, store.id, [
    { productId: soap.id, quantity: '3', discount: '0.00' },
    { productId: rice.id, quantity: '1.5' },
  ]);
  expect(res.status).toBe(201);
  const sale = res.body.sale as {
    id: string;
    grandTotal: string;
    items: { id: string; lineTotal: string; productId: string }[];
  };
  return { ...owner, store, soap, rice, sale, soapLine: sale.items[0]!, riceLine: sale.items[1]! };
}

const stockOf = async (id: string) =>
  (await db.product.findUniqueOrThrow({ where: { id } })).stockQuantity.toFixed(3);

describe('returns', () => {
  it('partial returns refund proportionally and sum exactly to the line total', async () => {
    const { agent, store, sale, soapLine } = await soldBill();
    expect(soapLine.lineTotal).toBe('9.99');
    const refunds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await returnItems(agent, store.id, sale.id, {
        items: [{ saleItemId: soapLine.id, quantity: '1' }],
      });
      expect(r.status).toBe(201);
      refunds.push(r.body.sale.returns.at(-1).refundTotal);
    }
    expect(refunds).toEqual(['3.33', '3.33', '3.33']);
    const final = (await agent.get(`${salesUrl(store.id)}/${sale.id}`)).body.sale;
    expect(final.items[0].returnedQuantity).toBe('3.000');
    expect(final.status).toBe('PARTIALLY_RETURNED'); // rice still sold
  });

  it('cancelling a bill = returning every line; status becomes RETURNED and refunds equal the total', async () => {
    const { agent, store, sale, soapLine, riceLine, soap, rice } = await soldBill();
    const r = await returnItems(agent, store.id, sale.id, {
      items: [
        { saleItemId: soapLine.id, quantity: '3' },
        { saleItemId: riceLine.id, quantity: '1.5' },
      ],
      reason: 'Bill cancelled',
    });
    expect(r.status).toBe(201);
    expect(r.body.sale).toMatchObject({ status: 'RETURNED', refundedTotal: sale.grandTotal });
    expect(await stockOf(soap.id)).toBe('10.000');
    expect(await stockOf(rice.id)).toBe('20.000');
    const moves = await db.inventoryMovement.findMany({ where: { type: 'RETURN' } });
    expect(moves).toHaveLength(2);
    expect(await db.auditLog.count({ where: { action: 'sale.returned' } })).toBe(1);
  });

  it('does not restock when goods are damaged', async () => {
    const { agent, store, sale, riceLine, rice } = await soldBill();
    await returnItems(agent, store.id, sale.id, {
      items: [{ saleItemId: riceLine.id, quantity: '0.5' }],
      restock: false,
      reason: 'Insects',
    }).expect(201);
    expect(await stockOf(rice.id)).toBe('18.500');
  });

  it('cannot return more than was sold, across several returns', async () => {
    const { agent, store, sale, riceLine } = await soldBill();
    await returnItems(agent, store.id, sale.id, {
      items: [{ saleItemId: riceLine.id, quantity: '1' }],
    }).expect(201);
    const over = await returnItems(agent, store.id, sale.id, {
      items: [{ saleItemId: riceLine.id, quantity: '0.501' }],
    });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({
      code: 'RETURN_EXCEEDS_SOLD',
      details: { sold: '1.500', alreadyReturned: '1.000' },
    });
  });

  it('parallel returns of the last unit: exactly one succeeds', async () => {
    const { agent, store, sale, soapLine } = await soldBill();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        returnItems(agent, store.id, sale.id, { items: [{ saleItemId: soapLine.id, quantity: '2' }] }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it('is idempotent', async () => {
    const { agent, store, sale, riceLine } = await soldBill();
    const key = newIdemKey();
    const body = { items: [{ saleItemId: riceLine.id, quantity: '0.5' }] };
    await returnItems(agent, store.id, sale.id, body, key).expect(201);
    const again = await returnItems(agent, store.id, sale.id, body, key).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await db.saleReturn.count()).toBe(1);
  });

  it('rejects lines from another bill, duplicates, and cashiers', async () => {
    const { agent, store, sale, soapLine, rice } = await soldBill();
    const other = (await sell(agent, store.id, [{ productId: rice.id, quantity: '1' }])).body.sale;
    const foreign = await returnItems(agent, store.id, sale.id, {
      items: [{ saleItemId: other.items[0].id, quantity: '1' }],
    });
    expect(foreign.body.error.code).toBe('SALE_ITEM_NOT_FOUND');
    const dup = await returnItems(agent, store.id, sale.id, {
      items: [
        { saleItemId: soapLine.id, quantity: '1' },
        { saleItemId: soapLine.id, quantity: '1' },
      ],
    });
    expect(dup.body.error.code).toBe('DUPLICATE_RETURN_LINE');

    const cashier = await registerAgent(app, 'cashier');
    await db.storeMembership.create({
      data: { userId: cashier.user.id, storeId: store.id, role: 'CASHIER' },
    });
    await returnItems(cashier.agent, store.id, sale.id, {
      items: [{ saleItemId: soapLine.id, quantity: '1' }],
    }).expect(403);
    await cashier.agent.get(`${salesUrl(store.id)}/${sale.id}`).expect(200);
  });

  it('the original sale row is untouched by returns', async () => {
    const { agent, store, sale, riceLine } = await soldBill();
    const before = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
    await returnItems(agent, store.id, sale.id, {
      items: [{ saleItemId: riceLine.id, quantity: '1.5' }],
    }).expect(201);
    const after = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(after).toEqual(before);
  });
});

describe('sales list', () => {
  it('lists newest first with derived status and pages by bill number', async () => {
    const { agent, store, sale, riceLine, rice } = await soldBill();
    await sell(agent, store.id, [{ productId: rice.id, quantity: '1' }]);
    await sell(agent, store.id, [{ productId: rice.id, quantity: '1' }]);
    await returnItems(agent, store.id, sale.id, { items: [{ saleItemId: riceLine.id, quantity: '1' }] });

    const p1 = (await agent.get(salesUrl(store.id)).query({ limit: 2 }).expect(200)).body;
    expect(p1.sales.map((s: { number: number }) => s.number)).toEqual([3, 2]);
    const p2 = (await agent.get(salesUrl(store.id)).query({ limit: 2, beforeNumber: p1.nextBeforeNumber }))
      .body;
    expect(p2.sales).toEqual([
      expect.objectContaining({ number: 1, status: 'PARTIALLY_RETURNED', refundedTotal: '62.00' }),
    ]);
    expect(p2.nextBeforeNumber).toBeNull();
  });
});
