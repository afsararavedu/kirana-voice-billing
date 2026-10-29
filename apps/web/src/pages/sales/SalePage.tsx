import {
  FRACTIONAL_UNITS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type SaleDto,
  type UiLanguage,
} from '@kirana/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api, IdempotencyKeyFor } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';
import {
  compareDecimalStrings,
  formatDateTime,
  formatMoney,
  formatQty,
  subtractDecimal,
} from '../../lib/format';
import { useStore } from '../../stores/useStore';

const remainingOf = (i: SaleDto['items'][number]) => subtractDecimal(i.quantity, i.returnedQuantity, 3);

function ReturnForm({
  sale,
  storeId,
  onDone,
}: {
  sale: SaleDto;
  storeId: string;
  onDone: (s: SaleDto) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const [qty, setQty] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>(sale.payments[0]?.method ?? 'CASH');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const idem = useRef(new IdempotencyKeyFor());
  const open = sale.items.filter((i) => compareDecimalStrings(remainingOf(i), '0') > 0);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const items = open
      .map((i) => ({ saleItemId: i.id, quantity: (qty[i.id] ?? '').trim() }))
      .filter((i) => i.quantity && !/^0*(\.0*)?$/.test(i.quantity));
    if (items.length === 0) return;
    const body = {
      items,
      reason: String(f.get('reason') ?? '').trim(),
      restock: f.get('restock') === 'on',
      refundMethod,
    };
    setBusy(true);
    setError(null);
    try {
      const r = await api.createReturn(storeId, sale.id, body, idem.current.for(body));
      idem.current.reset();
      setQty({});
      onDone(r.sale);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      {open.map((i) => {
        const rem = remainingOf(i);
        return (
          <label key={i.id}>
            <span>
              <bdi>{i.productName}</bdi>{' '}
              <small>{t('sale.remaining', { qty: `${formatQty(rem, lang)} ${t(`units.${i.unit}`)}` })}</small>
            </span>
            <input
              inputMode="decimal"
              dir="ltr"
              placeholder="0"
              pattern={FRACTIONAL_UNITS.has(i.unit) ? '\\d{1,9}(\\.\\d{1,3})?' : '\\d{1,9}'}
              value={qty[i.id] ?? ''}
              onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))}
            />
          </label>
        );
      })}
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setQty(Object.fromEntries(open.map((i) => [i.id, remainingOf(i)])))}
      >
        {t('sale.returnAll')}
      </button>
      <label>
        {t('sale.reason')}
        <input name="reason" dir="auto" maxLength={255} required />
      </label>
      <label className="check">
        <input type="checkbox" name="restock" defaultChecked />
        {t('sale.restock')}
      </label>
      <label>
        {t('sale.refundMethod')}
        <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`payMethods.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <ErrorText error={error} />
      <button type="submit" disabled={busy}>
        {t('sale.submitReturn')}
      </button>
    </form>
  );
}

export function SalePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { storeId = '', saleId = '' } = useParams();
  const { canManage } = useStore(storeId);
  const [sale, setSale] = useState<SaleDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSale(storeId, saleId)
      .then((r) => setSale(r.sale))
      .catch(setError);
  }, [storeId, saleId]);

  if (!sale) {
    return (
      <section className="card">
        {error ? <ErrorText error={error} /> : <p role="status">{t('common.loading')}</p>}
      </section>
    );
  }

  const money = (s: string) => <bdi>{formatMoney(s, lang)}</bdi>;
  // Sign inside the isolate so Urdu (RTL) keeps it next to the figure.
  const minus = (s: string) => <bdi>−{formatMoney(s, lang)}</bdi>;

  return (
    <div className="stack">
      <section className="card">
        <p>
          <Link to={`/stores/${storeId}/sales`}>{t('sales.title')}</Link>
        </p>
        <div className="page-head">
          <h1>{t('sale.title', { number: sale.number })}</h1>
          <span>
            {sale.source === 'VOICE' && (
              <span className="badge" data-testid="sale-source">
                {t('voice.voiceBill')}
              </span>
            )}
            <span className={`badge ${sale.status === 'COMPLETED' ? '' : 'warn'}`} data-testid="sale-status">
              {t(`sales.status.${sale.status}`)}
            </span>
          </span>
        </div>
        <p className="muted">
          {t('sale.invoice')} <bdi data-testid="sale-invoice">{sale.invoiceNumber}</bdi> ·{' '}
          <bdi>{formatDateTime(sale.createdAt, lang)}</bdi> ·{' '}
          {t('sale.by', { name: sale.createdBy.displayName })}
        </p>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('billing.item')}</th>
                <th scope="col" className="num">
                  {t('billing.quantity')}
                </th>
                <th scope="col" className="num">
                  {t('billing.rate')}
                </th>
                <th scope="col" className="num">
                  {t('billing.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <bdi>{i.productName}</bdi>
                    {i.localNames[lang] && i.localNames[lang] !== i.productName && (
                      <div lang={lang} dir="auto" className="muted">
                        {i.localNames[lang]}
                      </div>
                    )}
                    <div className="muted">
                      GST {formatQty(i.taxRate, lang)}%
                      {i.discountAmount !== '0.00' && (
                        <>
                          {' · '}
                          {t('billing.discountTotal')} {money(i.discountAmount)}
                        </>
                      )}
                    </div>
                    {i.returnedQuantity !== '0.000' && (
                      <div className="warn-text">
                        {t('sale.returned')}: <bdi>{formatQty(i.returnedQuantity, lang)}</bdi>
                      </div>
                    )}
                  </td>
                  <td className="num">
                    <bdi>
                      {formatQty(i.quantity, lang)} {t(`units.${i.unit}`)}
                    </bdi>
                  </td>
                  <td className="num">{money(i.unitPrice)}</td>
                  <td className="num">{money(i.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="totals">
          <div>
            <dt>{t('billing.taxable')}</dt>
            <dd>{money(sale.taxableTotal)}</dd>
          </div>
          <div>
            <dt>{t('billing.gst')}</dt>
            <dd>{money(sale.taxTotal)}</dd>
          </div>
          {sale.discountTotal !== '0.00' && (
            <div>
              <dt>{t('billing.discountTotal')}</dt>
              <dd>{minus(sale.discountTotal)}</dd>
            </div>
          )}
          <div className="grand">
            <dt>{t('billing.grandTotal')}</dt>
            <dd data-testid="sale-total">{money(sale.grandTotal)}</dd>
          </div>
          {sale.refundedTotal !== '0.00' && (
            <div>
              <dt>{t('sales.refunded')}</dt>
              <dd data-testid="sale-refunded">{minus(sale.refundedTotal)}</dd>
            </div>
          )}
        </dl>

        <h2>{t('sale.payments')}</h2>
        <ul className="plain">
          {sale.payments.map((p, i) => (
            <li key={i}>
              {t(`payMethods.${p.method}`)}: {money(p.amount)}
              {p.tendered && p.change && (
                <span className="muted">
                  {' '}
                  · {t('billing.tendered')} {money(p.tendered)} · {t('billing.change')}{' '}
                  <span data-testid="sale-change">{money(p.change)}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {saved && <p role="status">{t('common.saved')}</p>}
        <p className="actions">
          <Link className="btn" to={`/stores/${storeId}/sales/${sale.id}/receipt`}>
            {t('sale.printReceipt')}
          </Link>
          <Link className="btn btn-ghost" to={`/stores/${storeId}/billing`}>
            {t('billing.title')}
          </Link>
        </p>
      </section>

      {sale.returns.length > 0 && (
        <section className="card">
          <h2>{t('sale.returnsTitle')}</h2>
          <ul className="plain">
            {sale.returns.map((r) => (
              <li key={r.id}>
                <bdi>{formatDateTime(r.createdAt, lang)}</bdi> · {t(`payMethods.${r.refundMethod}`)}{' '}
                {money(r.refundTotal)} · <bdi>{r.reason}</bdi>
                {!r.restocked && <span className="badge">{t('sale.notRestocked')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && sale.status !== 'RETURNED' && (
        <section className="card">
          <h2>{t('sale.returnTitle')}</h2>
          <ReturnForm
            sale={sale}
            storeId={storeId}
            onDone={(s) => {
              setSale(s);
              setSaved(true);
            }}
          />
        </section>
      )}
    </div>
  );
}
