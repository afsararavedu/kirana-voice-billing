import {
  FRACTIONAL_UNITS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type ProductDto,
  type SaleLineInput,
  type SaleQuoteDto,
  type UiLanguage,
  type Unit,
} from '@kirana/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, IdempotencyKeyFor } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';
import { VoicePanel, type VoicePick } from '../../components/VoicePanel';
import { compareDecimalStrings, formatMoney, formatQty, subtractDecimal } from '../../lib/format';
import { useStore } from '../../stores/useStore';

interface CartLine {
  productId: string;
  name: string;
  localName?: string;
  unit: Unit;
  quantity: string;
  discount: string;
}

const QUOTE_DEBOUNCE_MS = 300;
const SEARCH_DEBOUNCE_MS = 250;
const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
const qtyRe = (unit: Unit) => (FRACTIONAL_UNITS.has(unit) ? /^\d{1,9}(\.\d{1,3})?$/ : /^\d{1,9}$/);

const toLines = (cart: CartLine[]): SaleLineInput[] =>
  cart.map((l) => ({
    productId: l.productId,
    quantity: l.quantity,
    ...(l.discount && !/^0*(\.0*)?$/.test(l.discount) ? { discount: l.discount } : {}),
  }));

/**
 * The counter. The client never computes a price: every change to the cart asks the server for a
 * quote, the cashier shows that total to the customer, and confirm sends it back as
 * `expectedGrandTotal` so the server refuses to charge anything different.
 */
export function BillingPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { storeId = '' } = useParams();
  const navigate = useNavigate();
  const { store, canManage } = useStore(storeId);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductDto[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quote, setQuote] = useState<{ forLines: string; data: SaleQuoteDto } | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Any line added from voice labels the bill as a voice bill (reports only; pricing is identical).
  const [fromVoice, setFromVoice] = useState(false);
  const idem = useRef(new IdempotencyKeyFor());

  const lines = useMemo(() => toLines(cart), [cart]);
  const linesKey = JSON.stringify(lines);
  const cartValid =
    cart.length > 0 &&
    cart.every((l) => qtyRe(l.unit).test(l.quantity) && (!l.discount || MONEY_RE.test(l.discount)));

  // Product search.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .listProducts(storeId, { q: term })
        .then((r) => live && setResults(r.products.slice(0, 8)))
        .catch(() => live && setResults([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, storeId]);

  // Server quote whenever the cart changes.
  useEffect(() => {
    if (!cartValid) {
      setQuote(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .quoteSale(storeId, JSON.parse(linesKey) as SaleLineInput[])
        .then((r) => {
          if (!live) return;
          setQuote({ forLines: linesKey, data: r.quote });
          setQuoteError(null);
        })
        .catch((e: unknown) => {
          if (!live) return;
          setQuote(null);
          setQuoteError(e);
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [linesKey, cartValid, storeId]);

  function addProduct(p: ProductDto) {
    setNotice(null);
    setCart((c) =>
      c.some((l) => l.productId === p.id)
        ? c
        : [
            ...c,
            {
              productId: p.id,
              name: p.name,
              localName: p.localNames[lang],
              unit: p.unit,
              quantity: '1',
              discount: '',
            },
          ],
    );
    setQ('');
  }

  /** Reviewed voice lines join the cart; a product already in it takes the spoken quantity. */
  function addFromVoice(picks: VoicePick[]) {
    setNotice(null);
    setCart((c) => {
      const next = [...c];
      for (const { product: p, quantity } of picks) {
        const i = next.findIndex((l) => l.productId === p.id);
        const line: CartLine = {
          productId: p.id,
          name: p.name,
          localName: p.localNames[lang],
          unit: p.unit,
          quantity,
          discount: i >= 0 ? next[i]!.discount : '',
        };
        if (i >= 0) next[i] = line;
        else next.push(line);
      }
      return next;
    });
    setFromVoice(true);
  }

  const update = (i: number, patch: Partial<CartLine>) => {
    setNotice(null);
    setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const current = quote && quote.forLines === linesKey ? quote.data : null;
  const total = current?.totals.grandTotal ?? null;
  const cashOk =
    method !== 'CASH' ||
    !tendered ||
    (MONEY_RE.test(tendered) && total !== null && compareDecimalStrings(tendered, total) >= 0);
  const change =
    method === 'CASH' && tendered && MONEY_RE.test(tendered) && total && cashOk
      ? subtractDecimal(tendered, total, 2)
      : null;
  const canConfirm = !!current && current.shortages.length === 0 && cashOk && !busy;

  async function confirm() {
    if (!current) return;
    const grand = current.totals.grandTotal;
    const payments = /^0+\.00$/.test(grand)
      ? []
      : [{ method, amount: grand, ...(method === 'CASH' && tendered ? { tendered } : {}) }];
    const body = {
      items: lines,
      payments,
      expectedGrandTotal: grand,
      source: fromVoice ? ('VOICE' as const) : ('MANUAL' as const),
    };
    setBusy(true);
    setSubmitError(null);
    try {
      const { sale } = await api.finalizeSale(storeId, body, idem.current.for(body));
      idem.current.reset();
      navigate(`/stores/${storeId}/sales/${sale.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTAL_CHANGED') {
        const fresh = (e.details as { quote: SaleQuoteDto }).quote;
        setQuote({ forLines: linesKey, data: fresh });
        setNotice(t('billing.totalChanged'));
      } else {
        setSubmitError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  const shortageFor = (productId: string) => current?.shortages.find((s) => s.productId === productId);

  return (
    <div className="stack">
      <section className="card">
        <p>
          <Link to={`/stores/${storeId}`}>{store ? <bdi>{store.name}</bdi> : t('store.back')}</Link>
          {' · '}
          <Link to={`/stores/${storeId}/sales`}>{t('sales.title')}</Link>
        </p>
        <h1>{t('billing.title')}</h1>
        <label>
          {t('billing.search')}
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            dir="auto"
            autoFocus
            aria-describedby="add-hint"
          />
          <small id="add-hint">{t('billing.addHint')}</small>
        </label>
        {results.length > 0 && (
          <ul className="pick-list" aria-label={t('billing.search')}>
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" className="btn-ghost pick" onClick={() => addProduct(p)}>
                  <bdi>{p.name}</bdi>
                  {p.localNames[lang] && p.localNames[lang] !== p.name && (
                    <bdi lang={lang} className="muted">
                      {p.localNames[lang]}
                    </bdi>
                  )}
                  <span className="muted">
                    <bdi>
                      {formatMoney(p.sellingPrice, lang)} / {t(`units.${p.unit}`)}
                    </bdi>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <VoicePanel storeId={storeId} onAdd={addFromVoice} />

      <section className="card">
        {cart.length === 0 ? (
          <p>{t('billing.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table cart">
              <thead>
                <tr>
                  <th scope="col">{t('billing.item')}</th>
                  <th scope="col">{t('billing.quantity')}</th>
                  {canManage && <th scope="col">{t('billing.discount')}</th>}
                  <th scope="col" className="num">
                    {t('billing.amount')}
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">{t('billing.remove')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cart.map((l, i) => {
                  const line = current?.lines[i];
                  const short = shortageFor(l.productId);
                  return (
                    <tr key={l.productId}>
                      <td>
                        <bdi>{l.name}</bdi>
                        {l.localName && l.localName !== l.name && (
                          <div lang={lang} dir="auto" className="muted">
                            {l.localName}
                          </div>
                        )}
                        {line && (
                          <div className="muted">
                            <bdi>
                              {formatMoney(line.unitPrice, lang)} / {t(`units.${l.unit}`)}
                            </bdi>
                          </div>
                        )}
                        {short && (
                          <div className="error" role="alert">
                            {t('billing.short', { available: formatQty(short.available, lang) })}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          className="qty"
                          aria-label={`${t('billing.quantity')} ${l.name}`}
                          inputMode="decimal"
                          dir="ltr"
                          value={l.quantity}
                          aria-invalid={!qtyRe(l.unit).test(l.quantity)}
                          onChange={(e) => update(i, { quantity: e.target.value.trim() })}
                        />{' '}
                        <span className="muted">{t(`units.${l.unit}`)}</span>
                      </td>
                      {canManage && (
                        <td>
                          <input
                            className="qty"
                            aria-label={`${t('billing.discount')} ${l.name}`}
                            inputMode="decimal"
                            dir="ltr"
                            value={l.discount}
                            placeholder={t('billing.discount')}
                            aria-invalid={!!l.discount && !MONEY_RE.test(l.discount)}
                            onChange={(e) => update(i, { discount: e.target.value.trim() })}
                          />
                        </td>
                      )}
                      <td className="num">{line ? <bdi>{formatMoney(line.lineTotal, lang)}</bdi> : '…'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-ghost icon"
                          aria-label={`${t('billing.remove')} ${l.name}`}
                          onClick={() => setCart((c) => c.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ErrorText error={quoteError} />
      </section>

      {cart.length > 0 && (
        <section className="card">
          {current ? (
            <dl className="totals">
              <div>
                <dt>{t('billing.taxable')}</dt>
                <dd>
                  <bdi>{formatMoney(current.totals.taxableTotal, lang)}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t('billing.gst')}</dt>
                <dd>
                  <bdi>{formatMoney(current.totals.taxTotal, lang)}</bdi>
                </dd>
              </div>
              {current.totals.discountTotal !== '0.00' && (
                <div>
                  <dt>{t('billing.discountTotal')}</dt>
                  <dd>
                    <bdi>−{formatMoney(current.totals.discountTotal, lang)}</bdi>
                  </dd>
                </div>
              )}
              <div className="grand">
                <dt>{t('billing.grandTotal')}</dt>
                <dd>
                  <bdi data-testid="grand-total">{formatMoney(current.totals.grandTotal, lang)}</bdi>
                </dd>
              </div>
            </dl>
          ) : (
            <p role="status">{t('common.loading')}</p>
          )}

          <fieldset className="pay">
            <legend>{t('billing.method')}</legend>
            <div className="segmented">
              {PAYMENT_METHODS.map((m) => (
                <label key={m} className={method === m ? 'on' : ''}>
                  <input
                    type="radio"
                    name="method"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                  />
                  {t(`payMethods.${m}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {method === 'CASH' && (
            <div className="grid-3">
              <label>
                {t('billing.tendered')}
                <input
                  inputMode="decimal"
                  dir="ltr"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value.trim())}
                  aria-invalid={!cashOk}
                />
              </label>
              {change && (
                <p className="change" role="status">
                  {t('billing.change')}: <bdi data-testid="change">{formatMoney(change, lang)}</bdi>
                </p>
              )}
            </div>
          )}

          {notice && (
            <p className="warn-text" role="alert">
              {notice}
            </p>
          )}
          <ErrorText error={submitError} />
          <p className="muted">{t('billing.confirmHint')}</p>
          <div className="actions">
            <button type="button" className="big" disabled={!canConfirm} onClick={() => void confirm()}>
              {t('billing.confirm', { total: total ? formatMoney(total, lang) : '' })}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setCart([]);
                setFromVoice(false);
                setTendered('');
                setNotice(null);
                setSubmitError(null);
              }}
            >
              {t('billing.clear')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
