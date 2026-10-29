import {
  FRACTIONAL_UNITS,
  STOCK_MOVEMENT_KINDS,
  type ProductDto,
  type StockMovementDto,
  type StockMovementInput,
  type UiLanguage,
  type UpdateProductInput,
} from '@kirana/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';
import { formatDateTime, formatMoney, formatQty, formatSignedQty, isLowStock } from '../../lib/format';
import { useStore } from '../../stores/useStore';
import { ProductForm } from './ProductForm';

type Kind = (typeof STOCK_MOVEMENT_KINDS)[number];

function StockForm({
  product,
  onRecorded,
  storeId,
}: {
  product: ProductDto;
  storeId: string;
  onRecorded: (p: ProductDto, noChange: boolean) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>('RECEIVE');
  // One key per user action: a network retry of the same submit reuses it, so stock moves once.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fractional = FRACTIONAL_UNITS.has(product.unit);
  const qtyPattern = fractional ? '\\d{1,9}(\\.\\d{1,3})?' : '\\d{1,9}';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const qty = String(f.get('qty') ?? '').trim();
    const note = String(f.get('note') ?? '').trim() || undefined;
    const input: StockMovementInput =
      kind === 'COUNT'
        ? { type: 'COUNT', countedQuantity: qty, note }
        : kind === 'ADJUST'
          ? { type: 'ADJUST', quantityDelta: qty, note: note ?? '' }
          : { type: kind, quantity: qty, note };
    setBusy(true);
    setError(null);
    try {
      const r = await api.recordMovement(storeId, product.id, input, idemKey);
      onRecorded(r.product, r.movement === null);
      form.reset();
      setIdemKey(crypto.randomUUID());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} onChange={() => setError(null)}>
      <div className="grid-3">
        <label>
          {t('stock.type')}
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {STOCK_MOVEMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`stock.kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {kind === 'COUNT' ? t('stock.counted') : kind === 'ADJUST' ? t('stock.delta') : t('stock.quantity')}
          <input
            name="qty"
            inputMode="decimal"
            dir="ltr"
            required
            pattern={kind === 'ADJUST' ? `-?${qtyPattern}` : qtyPattern}
            key={kind}
          />
        </label>
        <label>
          {kind === 'ADJUST' ? t('stock.noteRequired') : t('stock.note')}
          <input name="note" dir="auto" maxLength={255} required={kind === 'ADJUST'} />
        </label>
      </div>
      <ErrorText error={error} />
      <button type="submit" disabled={busy}>
        {t('stock.submit')}
      </button>
    </form>
  );
}

export function ProductPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { storeId = '', productId = '' } = useParams();
  const { canManage } = useStore(storeId);
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [movements, setMovements] = useState<StockMovementDto[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const loadLedger = useCallback(
    () =>
      api
        .listMovements(storeId, productId)
        .then((r) => setMovements(r.movements))
        .catch(setError),
    [storeId, productId],
  );

  useEffect(() => {
    api
      .getProduct(storeId, productId)
      .then((r) => setProduct(r.product))
      .catch(setError);
    void loadLedger();
  }, [storeId, productId, loadLedger]);

  if (!product) {
    return (
      <section className="card">
        {error ? <ErrorText error={error} /> : <p role="status">{t('common.loading')}</p>}
      </section>
    );
  }

  const unitLabel = t(`units.${product.unit}`);
  const low = isLowStock(product.stockQuantity, product.lowStockThreshold);

  return (
    <div className="stack">
      <section className="card">
        <p>
          <Link to={`/stores/${storeId}/products`}>{t('products.title')}</Link>
        </p>
        <div className="page-head">
          <h1>
            <bdi>{product.name}</bdi>
          </h1>
          {canManage && !editing && (
            <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
              {t('products.edit')}
            </button>
          )}
        </div>
        {editing ? (
          <ProductForm
            product={product}
            submitLabel={t('common.save')}
            onSubmit={async (body) => {
              const r = await api.updateProduct(storeId, productId, body as UpdateProductInput);
              setProduct(r.product);
              setEditing(false);
              setStatus(t('common.saved'));
            }}
          />
        ) : (
          <dl className="facts">
            <div>
              <dt>{t('stock.current')}</dt>
              <dd>
                <bdi data-testid="stock-qty">
                  {formatQty(product.stockQuantity, lang)} {unitLabel}
                </bdi>
                {low && <span className="badge warn">{t('products.lowStock')}</span>}
              </dd>
            </div>
            <div>
              <dt>{t('products.price')}</dt>
              <dd>
                <bdi>{formatMoney(product.sellingPrice, lang)}</bdi> / {unitLabel}
              </dd>
            </div>
            <div>
              <dt>{t('product.taxRate')}</dt>
              <dd>
                <bdi>{formatQty(product.taxRate, lang)}%</bdi>
                {product.priceIncludesTax && <small> · {t('product.priceIncludesTax')}</small>}
              </dd>
            </div>
            {product.aliases.length > 0 && (
              <div>
                <dt>{t('product.aliasesShort')}</dt>
                <dd>
                  <bdi>{product.aliases.join(', ')}</bdi>
                </dd>
              </div>
            )}
          </dl>
        )}
        {status && <p role="status">{status}</p>}
      </section>

      {canManage && product.isActive && (
        <section className="card">
          <h2>{t('stock.record')}</h2>
          <StockForm
            product={product}
            storeId={storeId}
            onRecorded={(p, noChange) => {
              setProduct(p);
              setStatus(noChange ? t('stock.noChange') : t('common.saved'));
              void loadLedger();
            }}
          />
        </section>
      )}

      <section className="card">
        <h2>{t('stock.ledgerTitle')}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('stock.when')}</th>
                <th scope="col">{t('stock.type')}</th>
                <th scope="col" className="num">
                  {t('stock.quantity')}
                </th>
                <th scope="col" className="num">
                  {t('stock.balance')}
                </th>
                <th scope="col">{t('stock.note')}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>
                    <bdi>{formatDateTime(m.createdAt, lang)}</bdi>
                  </td>
                  <td>{t(`stock.movement.${m.type}`)}</td>
                  <td className="num">
                    <bdi>{formatSignedQty(m.quantityDelta, lang)}</bdi>
                  </td>
                  <td className="num">
                    <bdi>{formatQty(m.balanceAfter, lang)}</bdi>
                  </td>
                  <td>
                    <bdi>{m.note}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
