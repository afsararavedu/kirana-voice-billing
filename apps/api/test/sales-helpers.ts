import type request from 'supertest';
import { newIdemKey } from './helpers.js';

type Agent = ReturnType<typeof request.agent>;
export interface Line {
  productId: string;
  quantity: string;
  discount?: string;
}

export const salesUrl = (storeId: string) => `/api/v1/stores/${storeId}/sales`;

export async function quote(agent: Agent, storeId: string, items: Line[]) {
  const res = await agent
    .post(`${salesUrl(storeId)}/quote`)
    .send({ items })
    .expect(200);
  return res.body.quote as {
    totals: { grandTotal: string; taxTotal: string; taxableTotal: string; discountTotal: string };
    lines: { lineTotal: string; taxAmount: string; available: string }[];
    shortages: { productId: string; requested: string; available: string }[];
  };
}

/** Quote then finalize, paying the quoted total in cash unless payments are given. */
export async function sell(
  agent: Agent,
  storeId: string,
  items: Line[],
  opts: { payments?: object[]; key?: string; expected?: string } = {},
) {
  const expected = opts.expected ?? (await quote(agent, storeId, items)).totals.grandTotal;
  const payments = opts.payments ?? (/^0+\.00$/.test(expected) ? [] : [{ method: 'CASH', amount: expected }]);
  return agent
    .post(salesUrl(storeId))
    .set('Idempotency-Key', opts.key ?? newIdemKey())
    .send({ items, payments, expectedGrandTotal: expected });
}

export function returnItems(
  agent: Agent,
  storeId: string,
  saleId: string,
  body: {
    items: { saleItemId: string; quantity: string }[];
    reason?: string;
    restock?: boolean;
    refundMethod?: string;
  },
  key = newIdemKey(),
) {
  return agent
    .post(`${salesUrl(storeId)}/${saleId}/returns`)
    .set('Idempotency-Key', key)
    .send({ reason: 'Customer returned', refundMethod: 'CASH', ...body });
}

/** `sell` that asserts the HTTP status (sell is async, so supertest's `.expect` is unavailable). */
export async function sellExpect(
  status: number,
  ...args: Parameters<typeof sell>
): Promise<Awaited<ReturnType<typeof sell>>> {
  const res = await sell(...args);
  if (res.status !== status) {
    throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res;
}
