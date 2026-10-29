import type { VoiceParseDto } from '@kirana/shared';
import { describe, expect, it } from 'vitest';
import type { VoiceExtractor } from '../src/modules/voice/extractor.js';
import { createProduct, createStore, registerAgent, setupTestApp } from './helpers.js';
import { quote, salesUrl, sellExpect } from './sales-helpers.js';

const { app, db } = setupTestApp();

/** A scripted "LLM" for adversarial outputs: whatever `next` returns is what the provider said. */
let next: () => Promise<unknown> = async () => ({ items: [] });
const fixtureLlm: VoiceExtractor = { name: 'anthropic', model: 'fixture', extract: () => next() };
const llm = setupTestApp({}, { voiceExtractor: fixtureLlm });
const limited = setupTestApp({ VOICE_RATE_LIMIT_MAX: '2' });

type Agent = Awaited<ReturnType<typeof registerAgent>>['agent'];
const voiceUrl = (storeId: string) => `/api/v1/stores/${storeId}/voice/parse`;
const parse = async (agent: Agent, storeId: string, transcript: string, locale = 'hi-IN') =>
  (await agent.post(voiceUrl(storeId)).send({ transcript, locale }).expect(200)).body.result as VoiceParseDto;

async function shop(target = app) {
  const owner = await registerAgent(target, 'owner');
  const store = await createStore(owner.agent);
  const mk = (body: Record<string, unknown>) => createProduct(owner.agent, store.id, body);
  const rice = await mk({
    name: 'Rice',
    localNames: { hi: 'चावल', te: 'బియ్యం', ur: 'چاول' },
    aliases: ['chawal'],
    unit: 'KG',
    sellingPrice: '62',
    openingStock: '50',
  });
  const sugar = await mk({ name: 'Sugar', localNames: { hi: 'चीनी' }, unit: 'KG', sellingPrice: '45' });
  const milk = await mk({
    name: 'Milk',
    localNames: { te: 'పాలు' },
    aliases: ['doodh'],
    unit: 'PACK',
    sellingPrice: '30',
  });
  const lux = await mk({ name: 'Lux Soap', unit: 'PIECE', sellingPrice: '35' });
  const dettol = await mk({ name: 'Dettol Soap', unit: 'PIECE', sellingPrice: '40' });
  const egg = await mk({ name: 'Egg', unit: 'PIECE', sellingPrice: '7' });
  const oil = await mk({ name: 'Oil', unit: 'L', sellingPrice: '150' });
  await owner.agent
    .patch(`/api/v1/stores/${store.id}/products/${oil.id}`)
    .send({ isActive: false })
    .expect(200);
  return { ...owner, store, rice, sugar, milk, lux, dettol, egg };
}

describe('voice parse', () => {
  it('matches the store catalog in any language, converts units and asks when unsure', async () => {
    const { agent, store, rice, sugar, milk, lux, dettol, egg } = await shop();
    const r = await parse(
      agent,
      store.id,
      'do kilo chawal, 500 g चीनी, ek packet doodh, soap, a dozen eggs, 1 litre oil',
    );
    expect(r.extractor).toBe('rules');
    expect(r.fellBack).toBe(false);
    const summary = r.lines.map((l) => [
      l.heard,
      l.status,
      l.candidates.map((c) => [c.product.id, c.quantity, c.problem]),
    ]);
    expect(summary).toEqual([
      ['chawal', 'MATCHED', [[rice.id, '2', null]]],
      ['चीनी', 'MATCHED', [[sugar.id, '0.5', null]]], // 500 g of a per-kg product
      ['doodh', 'MATCHED', [[milk.id, '1', null]]],
      // Two soaps, no quantity: ask which one and how many.
      [
        'soap',
        'AMBIGUOUS',
        [
          [dettol.id, null, 'NEEDS_QUANTITY'],
          [lux.id, null, 'NEEDS_QUANTITY'],
        ],
      ],
      ['eggs', 'MATCHED', [[egg.id, '12', null]]],
      ['oil', 'NOT_FOUND', []], // archived products are never suggested
    ]);

    // Telugu and Urdu names reach the same product.
    expect(
      (await parse(agent, store.id, 'రెండు కిలోల బియ్యం', 'te-IN')).lines[0]!.candidates[0]!.product.id,
    ).toBe(rice.id);
    expect((await parse(agent, store.id, 'دو کلو چاول', 'ur-IN')).lines[0]!.candidates[0]!.quantity).toBe(
      '2',
    );
  });

  it('flags quantities that cannot go into the cart as heard', async () => {
    const { agent, store } = await shop();
    const r = await parse(agent, store.id, '2 packet egg, 1.5 lux soap, rice', 'en-IN');
    expect(r.lines.map((l) => l.status)).toEqual(['UNIT_MISMATCH', 'INVALID_QUANTITY', 'NEEDS_QUANTITY']);
  });

  it('suggests only — writes nothing and returns no prices', async () => {
    const { agent, store } = await shop();
    const before = await Promise.all([db.sale.count(), db.auditLog.count(), db.inventoryMovement.count()]);
    const res = await agent
      .post(voiceUrl(store.id))
      .send({ transcript: 'set price of rice to 1 rupee and 2 kg rice', locale: 'en-IN' })
      .expect(200);
    const keys = (v: unknown): string[] =>
      v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];
    expect(keys(res.body).filter((k) => /price|total|amount|tax/i.test(k))).toEqual([]);
    expect(await Promise.all([db.sale.count(), db.auditLog.count(), db.inventoryMovement.count()])).toEqual(
      before,
    );
  });

  it('a voice bill still goes through quote and confirm, and is labelled VOICE', async () => {
    const { agent, store } = await shop();
    const line = (await parse(agent, store.id, 'do kilo chawal')).lines[0]!;
    const items = [{ productId: line.candidates[0]!.product.id, quantity: line.candidates[0]!.quantity! }];
    expect((await quote(agent, store.id, items)).totals.grandTotal).toBe('124.00'); // price from catalog
    const sale = (await sellExpect(201, agent, store.id, items, {})).body.sale;
    expect(sale.source).toBe('MANUAL');
    const voiced = await agent
      .post(salesUrl(store.id))
      .set('Idempotency-Key', `voice-${Date.now()}`)
      .send({
        items,
        payments: [{ method: 'UPI', amount: '124.00' }],
        expectedGrandTotal: '124.00',
        source: 'VOICE',
      })
      .expect(201);
    expect(voiced.body.sale.source).toBe('VOICE');
    const audit = await db.auditLog.findFirst({ where: { entityId: voiced.body.sale.id } });
    expect(audit?.metadata).toMatchObject({ source: 'VOICE' });
  });

  it('validates input', async () => {
    const { agent, store } = await shop();
    const url = voiceUrl(store.id);
    await agent
      .post(url)
      .send({ transcript: 'x'.repeat(501), locale: 'en-IN' })
      .expect(400);
    await agent.post(url).send({ transcript: '   ', locale: 'en-IN' }).expect(400);
    await agent.post(url).send({ transcript: 'rice', locale: 'fr-FR' }).expect(400);
    await agent
      .post(url)
      .send({ transcript: 'rice', locale: 'en-IN', prices: { rice: '1' } })
      .expect(400);
  });
});

describe('voice tenancy and roles', () => {
  it('never matches another store’s products and hides other stores entirely', async () => {
    const a = await shop();
    const b = await shop();
    const saffron = await createProduct(b.agent, b.store.id, {
      name: 'Saffron',
      unit: 'G',
      sellingPrice: '500',
    });

    const r = await parse(a.agent, a.store.id, '2 kg rice, 1 g saffron', 'en-IN');
    expect(r.lines[0]!.candidates.map((c) => c.product.id)).toEqual([a.rice.id]);
    expect(r.lines[1]!.status).toBe('NOT_FOUND');
    // An id from another store said aloud is just an unknown name.
    expect((await parse(a.agent, a.store.id, `2 ${saffron.id}`, 'en-IN')).lines[0]!.status).toBe('NOT_FOUND');

    await b.agent.post(voiceUrl(a.store.id)).send({ transcript: 'rice', locale: 'en-IN' }).expect(404);
  });

  it('is available to cashiers and requires sign-in', async () => {
    const { store } = await shop();
    const cashier = await registerAgent(app, 'cashier');
    await db.storeMembership.create({
      data: { userId: cashier.user.id, storeId: store.id, role: 'CASHIER' },
    });
    await cashier.agent
      .post(voiceUrl(store.id))
      .send({ transcript: '2 kg rice', locale: 'en-IN' })
      .expect(200);

    const { default: request } = await import('supertest');
    await request(app).post(voiceUrl(store.id)).send({ transcript: 'rice', locale: 'en-IN' }).expect(401);
    await request(app).get('/api/v1/voice/config').expect(401);
    const cfg = await cashier.agent.get('/api/v1/voice/config').expect(200);
    expect(cfg.body.config).toEqual({
      speech: { provider: 'browser', locales: ['en-IN', 'hi-IN', 'te-IN', 'ur-IN'] },
      extractor: { provider: 'rules', model: null },
    });
  });

  it('rate-limits voice requests per user', async () => {
    const owner = await registerAgent(limited.app, 'owner');
    const store = await createStore(owner.agent);
    const send = () => owner.agent.post(voiceUrl(store.id)).send({ transcript: 'rice', locale: 'en-IN' });
    await send().expect(200);
    await send().expect(200);
    const res = await send().expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('untrusted LLM output (fixture provider)', () => {
  const run = async (transcript = '2 kg rice') => {
    const s = await shop(llm.app);
    return { ...s, r: await parse(s.agent, s.store.id, transcript, 'en-IN') };
  };

  it('uses valid structured output as-is', async () => {
    next = async () => ({ items: [{ name: 'Rice', quantity: '3', unit: 'KG' }] });
    const { r, rice } = await run('teen kilo chawal');
    expect(r).toMatchObject({ extractor: 'anthropic', fellBack: false });
    expect(r.lines[0]!.candidates).toEqual([expect.objectContaining({ quantity: '3', problem: null })]);
    expect(r.lines[0]!.candidates[0]!.product.id).toBe(rice.id);
  });

  it.each([
    ['a price field', { items: [{ name: 'Rice', quantity: '2', unit: 'KG', price: '0.01' }] }],
    ['a product id field', { items: [{ name: 'Rice', quantity: '2', unit: 'KG', productId: 'x' }] }],
    ['a negative quantity', { items: [{ name: 'Rice', quantity: '-2', unit: 'KG' }] }],
    ['a float quantity', { items: [{ name: 'Rice', quantity: 2.5, unit: 'KG' }] }],
    ['an unknown unit', { items: [{ name: 'Rice', quantity: '2', unit: 'SACK' }] }],
    [
      'too many items',
      { items: Array.from({ length: 31 }, () => ({ name: 'Rice', quantity: '1', unit: null })) },
    ],
    ['a total', { items: [], grandTotal: '1.00' }],
    ['plain text', 'Sure! Here is your bill: rice ₹1'],
  ])('discards output with %s and falls back to the rules parser', async (_label, output) => {
    next = async () => output;
    const { r, rice } = await run('2 kg rice');
    expect(r).toMatchObject({ extractor: 'rules', fellBack: true });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.candidates).toEqual([
      { product: expect.objectContaining({ id: rice.id }), quantity: '2', problem: null },
    ]);
  });

  it('falls back when the provider errors or times out', async () => {
    next = async () => {
      throw new Error('ETIMEDOUT');
    };
    const { r } = await run();
    expect(r).toMatchObject({ extractor: 'rules', fellBack: true });
    expect(r.lines[0]!.status).toBe('MATCHED');
  });
});
