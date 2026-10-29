import type { ApiErrorBody } from '@kirana/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
};

/** Maps errors to a stable JSON shape. Internal details are logged, never returned. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id ?? '');
  let status = 500;
  let body: ApiErrorBody['error'] = { code: 'INTERNAL', message: 'Something went wrong', requestId };

  if (err instanceof AppError) {
    status = err.status;
    body = {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details ? { details: err.details } : {}),
    };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId,
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', requestId };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON', requestId };
  }

  if (status >= 500) req.log.error({ err }, 'unhandled error');
  else req.log.info({ code: body.code, status }, 'request rejected');

  res.status(status).json({ error: body } satisfies ApiErrorBody);
};
