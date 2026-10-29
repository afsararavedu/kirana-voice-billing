import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeEach, inject } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';

export const WEB_ORIGIN = 'http://localhost:5173';

export function setupTestApp(
  env: Record<string, string> = {},
  deps: Pick<Parameters<typeof createApp>[0], 'voiceExtractor'> = {},
) {
  const databaseUrl = inject('databaseUrl');
  const config: AppConfig = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    WEB_ORIGINS: WEB_ORIGIN,
    RATE_LIMIT_MAX: '10000',
    AUTH_RATE_LIMIT_MAX: '10000',
    VOICE_RATE_LIMIT_MAX: '10000',
    ...env,
  });
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const app = createApp({ config, db, logger: pino({ level: 'silent' }), ...deps });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "InvoiceCounter", "SaleReturnItem","SaleReturn", "SalePayment", "SaleItem", "Sale", "IdempotencyKey", "InventoryMovement", "ProductAlias", "Product", "AuditLog", "Session", "StoreMembership", "Store", "User" RESTART IDENTITY CASCADE',
    );
  });
  afterAll(() => db.$disconnect());

  return { app, db, config };
}

let seq = 0;

/** Registers a user and returns a supertest agent that carries their session cookie. */
export async function registerAgent(app: Parameters<typeof request.agent>[0], name = 'user') {
  seq += 1;
  const agent = request.agent(app);
  const email = `${name}${seq}@example.in`;
  const res = await agent
    .post('/api/v1/auth/register')
    .send({ email, password: 'a sufficiently long password', displayName: name })
    .expect(201);
  return { agent, email, user: res.body.user as { id: string } };
}

type Agent = ReturnType<typeof request.agent>;

export async function createProduct(agent: Agent, storeId: string, body: Record<string, unknown> = {}) {
  const res = await agent
    .post(`/api/v1/stores/${storeId}/products`)
    .send({ name: 'Toor Dal', unit: 'KG', sellingPrice: '140.00', ...body })
    .expect(201);
  return res.body.product as { id: string; stockQuantity: string; sellingPrice: string; aliases: string[] };
}

let idemSeq = 0;
export const newIdemKey = () => `test-key-${Date.now()}-${++idemSeq}`;

export function postMovement(
  agent: Agent,
  storeId: string,
  productId: string,
  body: object,
  key = newIdemKey(),
) {
  return agent
    .post(`/api/v1/stores/${storeId}/products/${productId}/stock-movements`)
    .set('Idempotency-Key', key)
    .send(body);
}

export async function createStore(agent: ReturnType<typeof request.agent>, name = 'Lakshmi Kirana') {
  const res = await agent.post('/api/v1/stores').send({ name }).expect(201);
  return res.body.store as { id: string; name: string; role: string };
}
