import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { sha256Hex } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export interface IdempotencyContext {
  storeId: string;
  scope: string;
  key: string;
  requestHash: string;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

/** Reads the mandatory `Idempotency-Key` header and fingerprints the validated request. */
export function idempotencyContext(
  req: Request,
  storeId: string,
  scope: string,
  payload: unknown,
): IdempotencyContext {
  const key = req.get('idempotency-key');
  if (!key || !KEY_PATTERN.test(key)) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (8–128 chars) is required');
  }
  return { storeId, scope, key, requestHash: sha256Hex(JSON.stringify(payload)) };
}

/**
 * Inside the caller's transaction (after it has taken its row locks): returns the stored response
 * for a retried request, or null for a new one. A reused key with a different payload is rejected.
 */
export async function findReplay(
  tx: Prisma.TransactionClient,
  ctx: IdempotencyContext,
): Promise<StoredResponse | null> {
  const row = await tx.idempotencyKey.findUnique({
    where: { storeId_scope_key: { storeId: ctx.storeId, scope: ctx.scope, key: ctx.key } },
  });
  if (!row) return null;
  if (row.requestHash !== ctx.requestHash) {
    throw new AppError(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was used for a different request',
    );
  }
  return { status: row.responseStatus, body: row.responseBody };
}

/** Stores the response in the same transaction as the write it describes. */
export async function saveResponse(
  tx: Prisma.TransactionClient,
  ctx: IdempotencyContext,
  res: StoredResponse,
): Promise<void> {
  await tx.idempotencyKey.create({
    data: {
      storeId: ctx.storeId,
      scope: ctx.scope,
      key: ctx.key,
      requestHash: ctx.requestHash,
      responseStatus: res.status,
      responseBody: res.body as Prisma.InputJsonValue,
    },
  });
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
