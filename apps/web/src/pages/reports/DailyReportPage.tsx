import { businessDate, type DailySummaryDto, type UiLanguage } from '@kirana/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';
import { formatMoney, formatQty } from '../../lib/format';

export function DailyReportPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { storeId = '' } = useParams();
  const [date, setDate] = useState(() => businessDate(new Date()));
  const [summary, setSummary] = useState<DailySummaryDto | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setSummary(null);
    api
      .dailyReport(storeId, date)
      .then((r) => live && setSummary(r.summary))
      .catch((e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [storeId, date]);

  const money = (s: string) => <bdi>{formatMoney(s, lang)}</bdi>;
  const cash = summary?.payments.find((p) => p.method === 'CASH');

  return (
    <div className="stack">
      <section className="card">
        <p>
          <Link to={`/stores/${storeId}`}>{t('store.back')}</Link>
        </p>
        <div className="page-head">
          <h1>{t('reports.dailyTitle')}</h1>
          <label>
            {t('reports.date')}
            <input
              type="date"
              value={date}
              max={businessDate(new Date())}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </label>
        </div>
        <ErrorText error={error} />
        {!summary && !error && <p role="status">{t('common.loading')}</p>}
        {summary && (
          <>
            <dl className="facts">
              <div>
                <dt>{t('reports.bills')}</dt>
                <dd data-testid="report-bills">{summary.billCount}</dd>
              </div>
              <div>
                <dt>{t('reports.grossSales')}</dt>
                <dd>{money(summary.sales.grandTotal)}</dd>
              </div>
              <div>
                <dt>{t('reports.refunds')}</dt>
                <dd>
                  <bdi>−{formatMoney(summary.refunds.total, lang)}</bdi>{' '}
                  <small>({t('reports.returnCount', { n: summary.returnCount })})</small>
                </dd>
              </div>
              <div>
                <dt>{t('reports.netSales')}</dt>
                <dd data-testid="report-net">{money(summary.netSales)}</dd>
              </div>
              <div>
                <dt>{t('reports.gst')}</dt>
                <dd>{money(summary.sales.taxTotal)}</dd>
              </div>
              <div>
                <dt>{t('reports.discounts')}</dt>
                <dd>{money(summary.sales.discountTotal)}</dd>
              </div>
            </dl>
            <p className="muted">{t('reports.countingNote')}</p>
          </>
        )}
      </section>

      {summary && (
        <section className="card">
          <h2>{t('reports.byMethod')}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('reports.method')}</th>
                  <th scope="col" className="num">
                    {t('reports.collected')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.refunded')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.net')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.payments.map((p) => (
                  <tr key={p.method}>
                    <th scope="row">{t(`payMethods.${p.method}`)}</th>
                    <td className="num">{money(p.collected)}</td>
                    <td className="num">{money(p.refunded)}</td>
                    <td className="num" data-testid={`report-net-${p.method}`}>
                      {money(p.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cash && <p>{t('reports.cashInHand', { amount: formatMoney(cash.net, lang) })}</p>}
        </section>
      )}

      {summary && summary.taxByRate.length > 0 && (
        <section className="card">
          <h2>{t('reports.taxByRate')}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('reports.rate')}</th>
                  <th scope="col" className="num">
                    {t('reports.taxable')}
                  </th>
                  <th scope="col" className="num">
                    {t('receipt.cgst')}
                  </th>
                  <th scope="col" className="num">
                    {t('receipt.sgst')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.gst')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.taxByRate.map((r) => (
                  <tr key={r.rate}>
                    <th scope="row">
                      <bdi>{formatQty(r.rate, lang)}%</bdi>
                    </th>
                    <td className="num">{money(r.taxableValue)}</td>
                    <td className="num">{money(r.cgst)}</td>
                    <td className="num">{money(r.sgst)}</td>
                    <td className="num">{money(r.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
