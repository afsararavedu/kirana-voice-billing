import { fiscalYearLabel, fiscalYearOf, type ReceiptDto } from '@kirana/shared';
import { describe, expect, it } from 'vitest';
import { createProduct, createStore, registerAgent, setupTestApp } from './helpers.js';
import { returnItems, salesUrl, sellExpect } from './sales-helpers.js';

const { app, db } = setupTestApp();

const FY = fiscalYearOf(new Date());
const FY_LABEL = fiscalYearLabel(FY);
const GSTIN = '36AABCU9603R1ZO';

async function shop(profile: Record<string, unknown> = {}) {
  const owner = await registerAgent(app, 'owner');
  const store = await createStore(owner.agent, 'Lakshmi Kirana');
  if (Object.keys(profile).length) {
    await owner.agent.patch(`/api/v1/stores/${store.id}`).send(profile).expect(200);
  }
  // 5% inclusive: 2 x 52.50 = 105.00 → taxable 100.00 + GST 5.00
  const dal = await createProduct(owner.agent, store.id, {
    name: 'Toor Dal',
    localNames: { te: 'కంది పప్పు', hi: 'अरहर दाल', ur: 'ارہر دال' },
    unit: 'KG',
    sellingPrice: '52.50',
    taxRate: '5',
    openingStock: '10',
  });
  // 18% exclusive, no local names: 1 x 25.42 → 25.42 + 4.58 = 30.00
  const soap = await createProduct(owner.agent, store.id, {
    name: 'Soap',
    unit: 'PIECE',
    sellingPrice: '25.42',
    taxRate: '18',
    priceIncludesTax: false,
    openingStock: '10',
  });
  return { ...owner, store, dal, soap };
}

const receiptOf = async (
  agent: Awaited<ReturnType<typeof shop>>['agent'],
  storeId: string,
  saleId: string,
  q = '',
) => (await agent.get(`${salesUrl(storeId)}/${saleId}/receipt${q}`).expect(200)).body.receipt as ReceiptDto;

describe('invoice numbers', () => {
  it('runs one gap-free series per financial year, with the store prefix', async () => {
    const { agent, store, dal } = await shop({ invoicePrefix: 'lk' });
    const first = await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }]);
    expect(first.body.sale.invoiceNumber).toBe(`LK/${FY_LABEL}/1`);

    // A refused bill (stale total) must not consume a serial.
    await sellExpect(409, agent, store.id, [{ productId: dal.id, quantity: '1' }], { expected: '1.00' });
    const second = await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }]);
    expect(second.body.sale.invoiceNumber).toBe(`LK/${FY_LABEL}/2`);

    const list = await agent.get(salesUrl(store.id)).expect(200);
    expect(list.body.sales.map((s: { invoiceNumber: string }) => s.invoiceNumber)).toEqual([
      `LK/${FY_LABEL}/2`,
      `LK/${FY_LABEL}/1`,
    ]);
  });

  it('stays consecutive under concurrent bills', async () => {
    const { agent, store, dal } = await shop();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }]),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const serials = results
      .map((r) => Number(r.body.sale.invoiceNumber.split('/').at(-1)))
      .sort((a, b) => a - b);
    expect(serials).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('restarts at 1 in a new financial year', async () => {
    const { agent, store, dal } = await shop();
    // As if last year had 499 invoices: this year's series is independent.
    await db.invoiceCounter.create({ data: { storeId: store.id, fiscalYear: FY - 1, nextSeq: 500 } });
    const res = await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }]);
    expect(res.body.sale.invoiceNumber).toBe(`${FY_LABEL}/1`);
  });

  it('locks the prefix once the year has a bill', async () => {
    const { agent, store, dal } = await shop({ invoicePrefix: 'LK' });
    await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }]);
    const url = `/api/v1/stores/${store.id}`;
    const locked = await agent.patch(url).send({ invoicePrefix: 'SK' }).expect(409);
    expect(locked.body.error.code).toBe('INVOICE_PREFIX_LOCKED');
    await agent.patch(url).send({ invoicePrefix: null }).expect(409);
    // Unchanged prefix and other fields are fine.
    await agent.patch(url).send({ invoicePrefix: 'lk', address: 'Main Road' }).expect(200);
  });
});

describe('store profile', () => {
  it('validates GSTIN and prefix, and only the owner may change them', async () => {
    const { agent, store } = await shop();
    const url = `/api/v1/stores/${store.id}`;
    await agent.patch(url).send({ gstin: '36AABCU9603R1ZP' }).expect(400); // bad check character
    await agent.patch(url).send({ invoicePrefix: 'TOOLONG' }).expect(400);
    const ok = await agent
      .patch(url)
      .send({ gstin: GSTIN.toLowerCase(), phone: '+91 98480 22338', address: 'Main Road, Warangal' })
      .expect(200);
    expect(ok.body.store).toMatchObject({
      gstin: GSTIN,
      phone: '+91 98480 22338',
      address: 'Main Road, Warangal',
    });
    expect((await agent.patch(url).send({ gstin: '' }).expect(200)).body.store.gstin).toBeNull();

    const manager = await registerAgent(app, 'manager');
    await db.storeMembership.create({
      data: { userId: manager.user.id, storeId: store.id, role: 'MANAGER' },
    });
    await manager.agent.patch(url).send({ gstin: GSTIN }).expect(403);
  });
});

describe('receipt', () => {
  it('is a tax invoice in the receipt language with a CGST/SGST split', async () => {
    const { agent, store, dal, soap } = await shop({
      receiptLanguage: 'te',
      gstin: GSTIN,
      address: 'Main Road, Warangal',
      receiptFooter: 'ధన్యవాదాలు',
    });
    const sale = (
      await sellExpect(201, agent, store.id, [
        { productId: dal.id, quantity: '2' },
        { productId: soap.id, quantity: '1' },
      ])
    ).body.sale;

    const r = await receiptOf(agent, store.id, sale.id);
    expect(r).toMatchObject({
      language: 'te',
      kind: 'TAX_INVOICE',
      invoiceNumber: `${FY_LABEL}/1`,
      number: 1,
      seller: {
        name: 'Lakshmi Kirana',
        gstin: GSTIN,
        address: 'Main Road, Warangal',
        phone: null,
        footer: 'ధన్యవాదాలు',
      },
      totals: { taxableTotal: '125.42', taxTotal: '9.58', discountTotal: '0.00', grandTotal: '135.00' },
      refundedTotal: '0.00',
      netTotal: '135.00',
      status: 'COMPLETED',
    });
    // Local name where the catalog has one, else the catalog name.
    expect(r.lines.map((l) => [l.name, l.quantity, l.lineTotal])).toEqual([
      ['కంది పప్పు', '2.000', '105.00'],
      ['Soap', '1.000', '30.00'],
    ]);
    expect(r.taxSummary).toEqual([
      { rate: '5.00', taxableValue: '100.00', cgst: '2.50', sgst: '2.50', tax: '5.00' },
      { rate: '18.00', taxableValue: '25.42', cgst: '2.29', sgst: '2.29', tax: '4.58' },
    ]);

    // Reprint in another language on request.
    const ur = await receiptOf(agent, store.id, sale.id, '?lang=ur');
    expect(ur.language).toBe('ur');
    expect(ur.lines[0]!.name).toBe('ارہر دال');
    await agent.get(`${salesUrl(store.id)}/${sale.id}/receipt?lang=fr`).expect(400);
  });

  it('keeps the seller details of the day it was billed', async () => {
    const { agent, store, dal } = await shop({ gstin: GSTIN, address: 'Old Road' });
    const sale = (await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }])).body.sale;
    await agent.patch(`/api/v1/stores/${store.id}`).send({ address: 'New Road', gstin: null }).expect(200);

    const old = await receiptOf(agent, store.id, sale.id);
    expect(old.seller).toMatchObject({ address: 'Old Road', gstin: GSTIN });
    expect(old.kind).toBe('TAX_INVOICE');

    const next = (await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }])).body.sale;
    const plain = await receiptOf(agent, store.id, next.id);
    expect(plain).toMatchObject({ kind: 'BILL', seller: { address: 'New Road', gstin: null } });
  });

  it('shows refunds and the net amount after a return', async () => {
    const { agent, store, dal } = await shop();
    const sale = (await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '2' }])).body.sale;
    await returnItems(agent, store.id, sale.id, {
      items: [{ saleItemId: sale.items[0].id, quantity: '1' }],
    }).expect(201);
    const r = await receiptOf(agent, store.id, sale.id);
    expect(r).toMatchObject({ status: 'PARTIALLY_RETURNED', refundedTotal: '52.50', netTotal: '52.50' });
  });

  it('is visible to cashiers of the store and to no one else', async () => {
    const { agent, store, dal } = await shop();
    const sale = (await sellExpect(201, agent, store.id, [{ productId: dal.id, quantity: '1' }])).body.sale;

    const cashier = await registerAgent(app, 'cashier');
    await db.storeMembership.create({
      data: { userId: cashier.user.id, storeId: store.id, role: 'CASHIER' },
    });
    await cashier.agent.get(`${salesUrl(store.id)}/${sale.id}/receipt`).expect(200);

    const other = await registerAgent(app, 'other');
    const otherStore = await createStore(other.agent, 'Other');
    await other.agent.get(`${salesUrl(store.id)}/${sale.id}/receipt`).expect(404);
    // Own store, foreign sale id: still not found.
    await other.agent.get(`${salesUrl(otherStore.id)}/${sale.id}/receipt`).expect(404);
  });
});
