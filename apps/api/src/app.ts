import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { originCheck } from './middleware/origin-check.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { UserRepository } from './modules/auth/user.repository.js';
import { healthRouter } from './modules/health/health.routes.js';
import { InventoryService } from './modules/products/inventory.service.js';
import { ProductImportService } from './modules/products/product-import.service.js';
import { productRouter } from './modules/products/product.routes.js';
import { ProductService } from './modules/products/product.service.js';
import { reportRouter } from './modules/reports/report.routes.js';
import { ReportService } from './modules/reports/report.service.js';
import { saleRouter } from './modules/sales/sale.routes.js';
import { SaleService } from './modules/sales/sale.service.js';
import { StoreRepository } from './modules/stores/store.repository.js';
import { storeRouter } from './modules/stores/store.routes.js';
import { StoreService } from './modules/stores/store.service.js';
import { AnthropicExtractor } from './modules/voice/anthropic-extractor.js';
import type { VoiceExtractor } from './modules/voice/extractor.js';
import { ruleExtractor } from './modules/voice/rule-extractor.js';
import { voiceConfigRouter, voiceRouter } from './modules/voice/voice.routes.js';
import { VoiceService } from './modules/voice/voice.service.js';

export interface AppDeps {
  config: AppConfig;
  db: PrismaClient;
  logger: Logger;
  /** Tests inject fixture extractors; otherwise chosen by VOICE_EXTRACTOR. */
  voiceExtractor?: VoiceExtractor;
}

function extractorFor(config: AppConfig): VoiceExtractor {
  const a = config.voice.anthropic;
  return a ? new AnthropicExtractor(a.model, { apiKey: a.apiKey, timeoutMs: a.timeoutMs }) : ruleExtractor;
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
export const JSON_BODY_LIMIT = '100kb';
/** Only the catalog CSV import accepts a larger body. */
export const IMPORT_BODY_LIMIT = '2mb';
const IMPORT_PATH = /^\/api\/v1\/stores\/[^/]+\/products\/import$/;

export function createApp({ config, db, logger, voiceExtractor }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
    }),
  );
  app.use(helmet());
  const jsonSmall = express.json({ limit: JSON_BODY_LIMIT });
  const jsonImport = express.json({ limit: IMPORT_BODY_LIMIT });
  app.use((req, res, next) => (IMPORT_PATH.test(req.path) ? jsonImport : jsonSmall)(req, res, next));
  app.use(cookieParser());

  const users = new UserRepository(db);
  const sessions = new SessionService(db, config.sessionTtlMs, config.cookieSecure);
  const auth = new AuthService(db, users);
  const stores = new StoreRepository(db);
  const storeService = new StoreService(db);
  const productService = new ProductService(db);
  const inventoryService = new InventoryService(db);
  const importService = new ProductImportService(db);
  const saleService = new SaleService(db);
  const reportService = new ReportService(db);
  const voiceService = new VoiceService(
    db,
    voiceExtractor ?? extractorFor(config),
    config.voice.speechProvider,
    logger,
  );

  const apiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  });
  const authLimiter = rateLimit({
    windowMs: config.authRateLimit.windowMs,
    limit: config.authRateLimit.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res
        .status(429)
        .json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } }),
  });

  const v1 = express.Router();
  v1.use('/health', healthRouter(db));
  v1.use(apiLimiter, originCheck(config.webOrigins), authenticate(sessions));
  v1.use('/auth', authRouter(auth, sessions, authLimiter));
  v1.use(
    '/stores',
    storeRouter(stores, storeService, (tenant) => {
      tenant.use('/products', productRouter(productService, inventoryService, importService));
      tenant.use('/sales', saleRouter(saleService));
      tenant.use('/reports', reportRouter(reportService));
      tenant.use('/voice', voiceRouter(voiceService, config.voice.rateLimitMax));
    }),
  );
  v1.use('/voice', voiceConfigRouter(voiceService));

  app.use('/api/v1', v1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
