import type {
  ApiErrorBody,
  AuditEntryDto,
  CreateProductRequest,
  CreateReturnRequest,
  DailySummaryDto,
  FinalizeSaleRequest,
  LowStockItemDto,
  ReceiptDto,
  SaleDto,
  SaleLineInput,
  SaleQuoteDto,
  SaleSummaryDto,
  CreateStoreInput,
  ImportRowError,
  LoginInput,
  ProductDto,
  RegisterInput,
  StockMovementDto,
  StockMovementInput,
  StoreDto,
  UpdatePreferencesInput,
  UiLanguage,
  UpdateProductInput,
  UpdateStoreRequest,
  UserDto,
  VoiceConfigDto,
  VoiceParseDto,
  VoiceParseInput,
} from '@kirana/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? res.statusText, err?.details);
  }
  return json as T;
}

const enc = encodeURIComponent;
const products = (storeId: string) => `/stores/${enc(storeId)}/products`;
const sales = (storeId: string) => `/stores/${enc(storeId)}/sales`;
const reports = (storeId: string) => `/stores/${enc(storeId)}/reports`;

export interface ImportResult {
  valid: number;
  imported: number;
  errors: ImportRowError[];
  totalErrors: number;
}

export const api = {
  me: () => request<{ user: UserDto }>('GET', '/auth/me'),
  register: (input: RegisterInput) => request<{ user: UserDto }>('POST', '/auth/register', input),
  login: (input: LoginInput) => request<{ user: UserDto }>('POST', '/auth/login', input),
  logout: () => request<void>('POST', '/auth/logout'),
  updatePreferences: (input: UpdatePreferencesInput) =>
    request<{ user: UserDto }>('PATCH', '/auth/me/preferences', input),

  listStores: () => request<{ stores: StoreDto[] }>('GET', '/stores'),
  createStore: (input: CreateStoreInput) => request<{ store: StoreDto }>('POST', '/stores', input),
  getStore: (id: string) => request<{ store: StoreDto }>('GET', `/stores/${enc(id)}`),
  updateStore: (id: string, input: UpdateStoreRequest) =>
    request<{ store: StoreDto }>('PATCH', `/stores/${enc(id)}`, input),

  listProducts: (storeId: string, opts: { q?: string; includeInactive?: boolean; cursor?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.q) qs.set('q', opts.q);
    if (opts.includeInactive) qs.set('includeInactive', 'true');
    if (opts.cursor) qs.set('cursor', opts.cursor);
    const suffix = qs.size ? `?${qs}` : '';
    return request<{ products: ProductDto[]; nextCursor: string | null }>(
      'GET',
      `${products(storeId)}${suffix}`,
    );
  },
  getProduct: (storeId: string, id: string) =>
    request<{ product: ProductDto }>('GET', `${products(storeId)}/${enc(id)}`),
  createProduct: (storeId: string, input: CreateProductRequest) =>
    request<{ product: ProductDto }>('POST', products(storeId), input),
  updateProduct: (storeId: string, id: string, input: UpdateProductInput) =>
    request<{ product: ProductDto }>('PATCH', `${products(storeId)}/${enc(id)}`, input),
  listMovements: (storeId: string, id: string) =>
    request<{ movements: StockMovementDto[] }>('GET', `${products(storeId)}/${enc(id)}/stock-movements`),
  /** `idempotencyKey` must be stable across retries of the same user action. */
  recordMovement: (storeId: string, id: string, input: StockMovementInput, idempotencyKey: string) =>
    request<{ movement: StockMovementDto | null; product: ProductDto }>(
      'POST',
      `${products(storeId)}/${enc(id)}/stock-movements`,
      input,
      { 'Idempotency-Key': idempotencyKey },
    ),
  importProducts: (storeId: string, csv: string, dryRun: boolean) =>
    request<ImportResult>('POST', `${products(storeId)}/import`, { csv, dryRun }),

  quoteSale: (storeId: string, items: SaleLineInput[]) =>
    request<{ quote: SaleQuoteDto }>('POST', `${sales(storeId)}/quote`, { items }),
  /** `idempotencyKey` must be reused if the same confirm is retried. */
  finalizeSale: (storeId: string, input: FinalizeSaleRequest, idempotencyKey: string) =>
    request<{ sale: SaleDto }>('POST', sales(storeId), input, { 'Idempotency-Key': idempotencyKey }),
  listSales: (storeId: string, beforeNumber?: number) =>
    request<{ sales: SaleSummaryDto[]; nextBeforeNumber: number | null }>(
      'GET',
      `${sales(storeId)}${beforeNumber ? `?beforeNumber=${beforeNumber}` : ''}`,
    ),
  getSale: (storeId: string, saleId: string) =>
    request<{ sale: SaleDto }>('GET', `${sales(storeId)}/${enc(saleId)}`),
  createReturn: (storeId: string, saleId: string, input: CreateReturnRequest, idempotencyKey: string) =>
    request<{ sale: SaleDto }>('POST', `${sales(storeId)}/${enc(saleId)}/returns`, input, {
      'Idempotency-Key': idempotencyKey,
    }),
  voiceConfig: () => request<{ config: VoiceConfigDto }>('GET', '/voice/config'),
  /** Suggestions only: nothing is billed or priced until the cashier confirms the cart. */
  parseVoice: (storeId: string, input: VoiceParseInput) =>
    request<{ result: VoiceParseDto }>('POST', `/stores/${enc(storeId)}/voice/parse`, input),

  /** Without `lang` the receipt is in the bill's own receipt language. */
  getReceipt: (storeId: string, saleId: string, lang?: UiLanguage) =>
    request<{ receipt: ReceiptDto }>(
      'GET',
      `${sales(storeId)}/${enc(saleId)}/receipt${lang ? `?lang=${lang}` : ''}`,
    ),

  dailyReport: (storeId: string, date?: string) =>
    request<{ summary: DailySummaryDto }>(
      'GET',
      `${reports(storeId)}/daily${date ? `?date=${enc(date)}` : ''}`,
    ),
  lowStock: (storeId: string) =>
    request<{ items: LowStockItemDto[] }>('GET', `${reports(storeId)}/low-stock`),
  auditLog: (storeId: string, opts: { before?: string; entityType?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.before) qs.set('before', opts.before);
    if (opts.entityType) qs.set('entityType', opts.entityType);
    return request<{ entries: AuditEntryDto[]; nextBefore: string | null }>(
      'GET',
      `/stores/${enc(storeId)}/audit-logs${qs.size ? `?${qs}` : ''}`,
    );
  },
};

/**
 * Keeps one idempotency key per distinct request body: retrying the same confirm (e.g. after a
 * network error) reuses the key so the server applies it once; any change gets a fresh key.
 */
export class IdempotencyKeyFor {
  private body = '';
  private key = '';
  for(body: unknown): string {
    const json = JSON.stringify(body);
    if (json !== this.body) {
      this.body = json;
      this.key = crypto.randomUUID();
    }
    return this.key;
  }
  reset() {
    this.body = '';
  }
}
