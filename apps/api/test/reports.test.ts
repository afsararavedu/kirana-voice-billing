import { businessDate, type AuditEntryDto, type DailySummaryDto } from '@kirana/shared';
import { describe, expect, it } from 'vitest';
import { createProduct, createStore, postMovement, registerAgent, setupTestApp } from './helpers.js';
import { returnItems, sellExpect } from './sales-helpers.js';

const { app, db } = setupTestApp();

const today = businessDate(new Date());
const reports = (storeId: string) => `/api/v1/stores/${storeId}/reports`;

async function shop() {
  const owner = await registerAgent(app, 'owner');
  const store = await createStore(owner.agent);
  // 5% inclusive: 52.50/kg
  const dal = await createProduct(owner.agent, store.id, {
    name: 'Toor Dal',
    unit: 'KG',
    sellingPrice: '52.50',
    taxRate: '5',
    openingStock: '20',
  });
  // 18% exclusive: 25.42 + 4.58 = 30.00
  const soap = await createProduct(owner.agent, store.id, {
    name: 'Soap',
    unit: 'PIECE',
    sellingPrice: '25.42',
    taxRate: '18',
    priceIncludesTax: false,
    openingStock: '20',
  });
  return { ...owner, store, dal, soap };
}

async function addMember(storeId: string, role: 'MANAGER' | 'CASHIER') {
  const m = await registerAgent(app, role.toLowerCase());
  await db.storeMembership.create({ data: { userId: m.user.id, storeId, role } });
  return m;
}

describe('daily summary', () => {
  it('adds up the day’s bills, refunds, payment methods and GST by rate', async () => {
    const { agent, store, dal, soap } = await shop();
    // Bill 1: 2 kg dal = 105.00, cash 200 tendered (change does not count as takings).
    await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '2' }], {
      payments: [{ method: 'CASH', amount: '105.00', tendered: '200' }],
    });
    // Bill 2: 1 dal + 2 soap = 52.50 + (50.84 + 9.15) = 112.49, split UPI/cash.
    const second = (
      await sellExpect(
        201,
        agent,
        store.id,
        [
          { productId: dal.id, quantity: '1' },
          { productId: soap.id, quantity: '2' },
        ],
        {
          payments: [
            { method: 'UPI', amount: '100.00' },
            { method: 'CASH', amount: '12.49' },
          ],
        },
      )
    ).body.sale;
    // Refund one soap in cash: half of 59.99 rounds up to 30.00, of which GST 4.58 (half of 9.15).
    await returnItems(agent, store.id, second.id, {
      items: [{ saleItemId: second.items[1].id, quantity: '1' }],
    }).expect(201);

    // Another store's trade must not leak in.
    const other = await shop();
    await sellExpect(201, other.agent, other.store.id, [{ productId: other.dal.id, quantity: '5' }]);

    const s = (await agent.get(`${reports(store.id)}/daily`).expect(200)).body.summary as DailySummaryDto;
    expect(s).toEqual({
      date: today,
      billCount: 2,
      returnCount: 1,
      sales: { taxableTotal: '200.84', taxTotal: '16.65', discountTotal: '0.00', grandTotal: '217.49' },
      refunds: { total: '30.00', tax: '4.58' },
      netSales: '187.49',
      payments: [
        { method: 'CASH', collected: '117.49', refunded: '30.00', net: '87.49' },
        { method: 'UPI', collected: '100.00', refunded: '0.00', net: '100.00' },
        { method: 'CARD', collected: '0.00', refunded: '0.00', net: '0.00' },
      ],
      taxByRate: [
        { rate: '5.00', taxableValue: '150.00', cgst: '3.75', sgst: '3.75', tax: '7.50' },
        // Odd paisa: CGST takes it.
        { rate: '18.00', taxableValue: '50.84', cgst: '4.58', sgst: '4.57', tax: '9.15' },
      ],
    });
    // Same figures when the date is given explicitly.
    const explicit = await agent.get(`${reports(store.id)}/daily?date=${today}`).expect(200);
    expect(explicit.body.summary).toEqual(s);
  });

  it('is empty for a day with no trade and rejects bad dates', async () => {
    const { agent, store, dal } = await shop();
    await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }]);
    const s = (await agent.get(`${reports(store.id)}/daily?date=2020-01-01`).expect(200)).body.summary;
    expect(s).toMatchObject({ billCount: 0, netSales: '0.00', taxByRate: [] });
    await agent.get(`${reports(store.id)}/daily?date=2026-02-30`).expect(400);
    await agent.get(`${reports(store.id)}/daily?date=today`).expect(400);
  });

  it('is for owners and managers of the store only', async () => {
    const { store } = await shop();
    const manager = await addMember(store.id, 'MANAGER');
    const cashier = await addMember(store.id, 'CASHIER');
    await manager.agent.get(`${reports(store.id)}/daily`).expect(200);
    const denied = await cashier.agent.get(`${reports(store.id)}/daily`).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    const outsider = await registerAgent(app, 'outsider');
    await outsider.agent.get(`${reports(store.id)}/daily`).expect(404);
  });
});

describe('low-stock report', () => {
  it('lists out-of-stock first, then items at or below their alert level', async () => {
    const { agent, store } = await shop(); // dal and soap: plenty, no threshold
    const rice = await createProduct(agent, store.id, {
      name: 'Rice',
      unit: 'KG',
      sellingPrice: '62',
      openingStock: '4.5',
      lowStockThreshold: '5',
    });
    const atLevel = await createProduct(agent, store.id, {
      name: 'Atta',
      unit: 'KG',
      sellingPrice: '45',
      openingStock: '5',
      lowStockThreshold: '5',
    });
    const empty = await createProduct(agent, store.id, { name: 'Zeera', unit: 'PACK', sellingPrice: '20' });
    const archived = await createProduct(agent, store.id, {
      name: 'Old stock',
      unit: 'PACK',
      sellingPrice: '1',
    });
    await agent
      .patch(`/api/v1/stores/${store.id}/products/${archived.id}`)
      .send({ isActive: false })
      .expect(200);
    // Atta starts exactly at its level (listed); receiving 1 more (6 > 5) takes it off the list.
    await postMovement(agent, store.id, atLevel.id, { type: 'RECEIVE', quantity: '1' }).expect(201);

    const cashier = await addMember(store.id, 'CASHIER');
    const res = await cashier.agent.get(`${reports(store.id)}/low-stock`).expect(200);
    expect(
      res.body.items.map(
        (i: { product: { name: string }; shortfall: string | null; outOfStock: boolean }) => [
          i.product.name,
          i.shortfall,
          i.outOfStock,
        ],
      ),
    ).toEqual([
      ['Zeera', null, true],
      ['Rice', '0.500', false],
    ]);
    expect(res.body.items[1].product.id).toBe(rice.id);
    expect(res.body.items[0].product.id).toBe(empty.id);

    const outsider = await registerAgent(app, 'outsider');
    await outsider.agent.get(`${reports(store.id)}/low-stock`).expect(404);
  });
});

describe('audit log', () => {
  it('pages newest first with actor names, filters by entity, and ignores foreign cursors', async () => {
    const { agent, store, dal } = await shop(); // store.created + 2 × product.created
    await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }]);
    await agent.patch(`/api/v1/stores/${store.id}`).send({ address: 'Main Road' }).expect(200);
    const url = `/api/v1/stores/${store.id}/audit-logs`;

    const first = await agent.get(`${url}?limit=2`).expect(200);
    const page1 = first.body.entries as AuditEntryDto[];
    expect(page1.map((e) => e.action)).toEqual(['store.updated', 'sale.finalized']);
    expect(page1[0]!.actor?.displayName).toBe('owner');
    expect(page1[1]!.metadata).toMatchObject({ number: 1, grandTotal: '52.50' });
    expect(first.body.nextBefore).toBe(page1[1]!.id);

    const second = await agent.get(`${url}?limit=2&before=${first.body.nextBefore}`).expect(200);
    const third = await agent.get(`${url}?limit=2&before=${second.body.nextBefore}`).expect(200);
    const all = [...page1, ...second.body.entries, ...third.body.entries].map((e: AuditEntryDto) => e.action);
    expect(all).toEqual([
      'store.updated',
      'sale.finalized',
      'product.created',
      'product.created',
      'store.created',
    ]);
    expect(third.body.nextBefore).toBeNull();

    const sales = await agent.get(`${url}?entityType=Sale`).expect(200);
    expect(sales.body.entries.map((e: AuditEntryDto) => e.action)).toEqual(['sale.finalized']);
    await agent.get(`${url}?entityType=User`).expect(400);

    // A cursor from another store returns nothing rather than that store's neighbours.
    const other = await shop();
    const foreign = (await other.agent.get(`/api/v1/stores/${other.store.id}/audit-logs`).expect(200)).body
      .entries[0].id;
    const res = await agent.get(`${url}?before=${foreign}`).expect(200);
    expect(res.body).toEqual({ entries: [], nextBefore: null });
  });
});
