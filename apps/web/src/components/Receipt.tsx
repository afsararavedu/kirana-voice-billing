import { BUSINESS_TIME_ZONE, textDirection, type ReceiptDto } from '@kirana/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatMoney, formatQty } from '../lib/format';

/**
 * A printable receipt. Every label is in `receipt.language` — the store's receipt language, or a
 * reprint language — never the cashier's UI language. Times are always IST.
 */
export function Receipt({ receipt }: { receipt: ReceiptDto }) {
  const { i18n } = useTranslation();
  const lang = receipt.language;
  const t = i18n.getFixedT(lang);
  // Figures are left-to-right even on an Urdu receipt.
  const num = (s: string) => <bdi dir="ltr">{s}</bdi>;
  const money = (s: string) => num(formatMoney(s, lang));
  // The sign belongs inside the isolate, or RTL layout would move it to the far side.
  const minus = (s: string) => num(`−${formatMoney(s, lang)}`);
  const { seller, totals } = receipt;

  return (
    <article className="receipt" lang={lang} dir={textDirection(lang)} data-testid="receipt">
      <header className="receipt-head">
        <h2 dir="auto">{seller.name}</h2>
        {seller.address && <p dir="auto">{seller.address}</p>}
        {seller.phone && (
          <p>
            {t('receipt.phone')}: {num(seller.phone)}
          </p>
        )}
        {seller.gstin && (
          <p>
            {t('receipt.gstin')}: {num(seller.gstin)}
          </p>
        )}
        <p className="receipt-kind">{t(`receipt.${receipt.kind}`)}</p>
      </header>

      <dl className="receipt-meta">
        <div>
          <dt>{t('receipt.invoiceNo')}</dt>
          <dd data-testid="receipt-invoice">{num(receipt.invoiceNumber)}</dd>
        </div>
        <div>
          <dt>{t('receipt.date')}</dt>
          <dd>
            {/* Not forced LTR: the month name is in the receipt's script (Urdu dates read RTL). */}
            <bdi>{formatDateTime(receipt.createdAt, lang, BUSINESS_TIME_ZONE)}</bdi>
          </dd>
        </div>
        <div>
          <dt>{t('receipt.cashier')}</dt>
          <dd>
            <bdi>{receipt.cashier}</bdi>
          </dd>
        </div>
      </dl>

      <table className="receipt-lines">
        <thead>
          <tr>
            <th scope="col">{t('receipt.item')}</th>
            <th scope="col" className="num">
              {t('receipt.qty')} × {t('receipt.rate')}
            </th>
            <th scope="col" className="num">
              {t('receipt.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((l) => (
            <tr key={l.lineNo}>
              <td>
                <bdi>{l.name}</bdi>
                {l.discountAmount !== '0.00' && (
                  <div className="receipt-sub">
                    {t('receipt.discount')} {minus(l.discountAmount)}
                  </div>
                )}
              </td>
              <td className="num">
                {num(formatQty(l.quantity, lang))} {t(`units.${l.unit}`)} × {money(l.unitPrice)}
              </td>
              <td className="num">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {receipt.taxSummary.length > 0 && (
        <table className="receipt-tax">
          <caption>{t('receipt.gstSummary')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('receipt.gstRate')}</th>
              <th scope="col" className="num">
                {t('receipt.taxable')}
              </th>
              <th scope="col" className="num">
                {t('receipt.cgst')}
              </th>
              <th scope="col" className="num">
                {t('receipt.sgst')}
              </th>
            </tr>
          </thead>
          <tbody>
            {receipt.taxSummary.map((r) => (
              <tr key={r.rate}>
                <td>{num(`${formatQty(r.rate, lang)}%`)}</td>
                <td className="num">{money(r.taxableValue)}</td>
                <td className="num">{money(r.cgst)}</td>
                <td className="num">{money(r.sgst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="receipt-totals">
        {totals.discountTotal !== '0.00' && (
          <div>
            <dt>{t('receipt.discount')}</dt>
            <dd>{minus(totals.discountTotal)}</dd>
          </div>
        )}
        <div>
          <dt>{t('receipt.totalTax')}</dt>
          <dd>{money(totals.taxTotal)}</dd>
        </div>
        <div className="grand">
          <dt>{t('receipt.total')}</dt>
          <dd data-testid="receipt-total">{money(totals.grandTotal)}</dd>
        </div>
        {receipt.payments.map((p, i) => (
          <div key={i}>
            <dt>
              {t('receipt.paid')}: {t(`payMethods.${p.method}`)}
            </dt>
            <dd>{money(p.amount)}</dd>
          </div>
        ))}
        {receipt.payments.map(
          (p, i) =>
            p.tendered &&
            p.change && (
              <div key={`c${i}`}>
                <dt>
                  {t('receipt.tendered')} {money(p.tendered)} · {t('receipt.change')}
                </dt>
                <dd>{money(p.change)}</dd>
              </div>
            ),
        )}
        {receipt.refundedTotal !== '0.00' && (
          <>
            <div>
              <dt>
                {t('receipt.refunded')} ({t(`sales.status.${receipt.status}`)})
              </dt>
              <dd>{minus(receipt.refundedTotal)}</dd>
            </div>
            <div className="grand">
              <dt>{t('receipt.net')}</dt>
              <dd data-testid="receipt-net">{money(receipt.netTotal)}</dd>
            </div>
          </>
        )}
      </dl>

      <footer className="receipt-foot">
        <p dir="auto">{seller.footer ?? t('receipt.thanks')}</p>
      </footer>
    </article>
  );
}
