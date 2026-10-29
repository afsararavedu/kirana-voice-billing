import { describe, expect, it } from 'vitest';
import { createProduct, createStore, registerAgent, setupTestApp } from './helpers.js';

const { app, db } = setupTestApp();

async function setup() {
  const owner = await registerAgent(app, 'owner');
  const store = await createStore(owner.agent);
  const url = `/api/v1/stores/${store.id}/products/import`;
  return { ...owner, store, url };
}

const GOOD = [
  'name,unit,selling_price,tax_rate,price_includes_tax,sku,opening_stock,low_stock_threshold,name_hi,name_te,name_ur,aliases',
  'Toor Dal,kg,140.50,5,yes,DAL-1,25.5,5,अरहर दाल,కంది పప్పు,ارہر دال,tuvar;arhar',
  '"Soap, Lime",piece,30,18,true,SOAP-1,40,10,,,,',
  'Salt,PACK,22,0,,,,,,,,',
].join('\n');

describe('CSV import', () => {
  it('dry run validates without writing', async () => {
    const { agent, url } = await setup();
    const res = await agent.post(url).send({ csv: GOOD, dryRun: true }).expect(200);
    expect(res.body).toMatchObject({ valid: 3, imported: 0, errors: [] });
    expect(await db.product.count()).toBe(0);
  });

  it('imports all rows with opening stock ledger entries and one audit record', async () => {
    const { agent, store, url } = await setup();
    const res = await agent
      .post(url)
      .send({ csv: '\uFEFF' + GOOD })
      .expect(201);
    expect(res.body.imported).toBe(3);

    const dal = await db.product.findFirstOrThrow({ where: { storeId: store.id, sku: 'DAL-1' } });
    expect(dal.sellingPrice.toFixed(2)).toBe('140.50');
    expect(dal.stockQuantity.toFixed(3)).toBe('25.500');
    const soap = await db.product.findFirstOrThrow({ where: { storeId: store.id, sku: 'SOAP-1' } });
    expect(soap.name).toBe('Soap, Lime');
    expect(await db.inventoryMovement.count({ where: { storeId: store.id, type: 'OPENING' } })).toBe(2);
    expect(await db.auditLog.count({ where: { storeId: store.id, action: 'product.imported' } })).toBe(1);

    const found = await agent.get(`/api/v1/stores/${store.id}/products`).query({ q: 'కంది' }).expect(200);
    expect(found.body.products[0].name).toBe('Toor Dal');
  });

  it('reports row-level errors and imports nothing when any row is invalid', async () => {
    const { agent, url } = await setup();
    const csv = [
      'name,unit,selling_price,opening_stock,sku',
      'Good,KG,10,1,A',
      ',KG,10,,B', // missing name
      'Eggs,PIECE,6,2.5,C', // fractional count
      'Oil,LITRE,180,,D', // bad unit
      'Rice,KG,12.345,,A', // too many decimals + duplicate SKU
    ].join('\n');
    const res = await agent.post(url).send({ csv }).expect(422);
    expect(res.body.error.code).toBe('IMPORT_INVALID');
    const errs = res.body.error.details.errors as { row: number; field: string }[];
    expect(errs.map((e) => `${e.row}:${e.field}`)).toEqual(
      expect.arrayContaining(['3:name', '4:opening_stock', '5:unit', '6:selling_price']),
    );
    expect(await db.product.count()).toBe(0);
  });

  it('flags duplicate SKUs within the file and against the existing catalog', async () => {
    const { agent, store, url } = await setup();
    await createProduct(agent, store.id, { sku: 'EXIST' });
    const csv = ['name,unit,selling_price,sku', 'A,KG,1,EXIST', 'B,KG,1,DUP', 'C,KG,1,DUP'].join('\n');
    const res = await agent.post(url).send({ csv, dryRun: true }).expect(200);
    expect(res.body.errors).toEqual([
      { row: 2, field: 'sku', message: 'Already used by a product in this store' },
      { row: 4, field: 'sku', message: 'Duplicate of row 3' },
    ]);
  });

  it('rejects unknown or missing columns, malformed CSV and empty files', async () => {
    const { agent, url } = await setup();
    const hdr = await agent.post(url).send({ csv: 'name,unit,price\nX,KG,1' }).expect(422);
    expect(hdr.body.error).toMatchObject({
      code: 'IMPORT_INVALID_HEADER',
      details: { missing: ['selling_price'], unknown: ['price'] },
    });
    const bad = await agent.post(url).send({ csv: 'name,unit,selling_price\n"X,KG,1' }).expect(422);
    expect(bad.body.error.code).toBe('IMPORT_PARSE_ERROR');
    const empty = await agent.post(url).send({ csv: 'name,unit,selling_price\n' }).expect(422);
    expect(empty.body.error.code).toBe('IMPORT_EMPTY');
  });

  it('accepts a body larger than the normal 100 kB limit on the import route only', async () => {
    const { agent, store, url } = await setup();
    const rows = Array.from(
      { length: 1500 },
      (_, i) => `Product number ${i} with a reasonably long descriptive name,KG,${i}.50,,,SKU-${i}`,
    );
    const csv = ['name,unit,selling_price,tax_rate,price_includes_tax,sku', ...rows].join('\n');
    expect(csv.length).toBeGreaterThan(100_000);
    const res = await agent.post(url).send({ csv }).expect(201);
    expect(res.body.imported).toBe(1500);
    await agent
      .post(`/api/v1/stores/${store.id}/products`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(150_000), unit: 'KG', sellingPrice: '1' }))
      .expect(413);
  });
});
