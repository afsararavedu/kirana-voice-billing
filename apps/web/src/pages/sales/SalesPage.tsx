import type { SaleSummaryDto, UiLanguage } from '@kirana/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';
import { formatDateTime, formatMoney } from '../../lib/format';

export function SalesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { storeId = '' } = useParams();
  const [sales, setSales] = useState<SaleSummaryDto[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .listSales(storeId)
      .then((r) => {
        setSales(r.sales);
        setNext(r.nextBeforeNumber);
      })
      .catch(setError);
  }, [storeId]);

  async function more() {
    if (!next) return;
    try {
      const r = await api.listSales(storeId, next);
      setSales((s) => [...(s ?? []), ...r.sales]);
      setNext(r.nextBeforeNumber);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section className="card">
      <p>
        <Link to={`/stores/${storeId}`}>{t('store.back')}</Link>
      </p>
      <div className="page-head">
        <h1>{t('sales.title')}</h1>
        <Link className="btn" to={`/stores/${storeId}/billing`}>
          {t('billing.title')}
        </Link>
      </div>
      <ErrorText error={error} />
      {sales === null && !error && <p role="status">{t('common.loading')}</p>}
      {sales?.length === 0 && <p>{t('sales.empty')}</p>}
      {sales && sales.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('sales.number')}</th>
                <th scope="col">{t('sales.when')}</th>
                <th scope="col" className="num">
                  {t('sales.total')}
                </th>
                <th scope="col">{t('sales.statusLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/stores/${storeId}/sales/${s.id}`}>#{s.number}</Link>
                    <div className="muted">
                      <bdi>{s.invoiceNumber}</bdi>
                    </div>
                  </td>
                  <td>
                    <bdi>{formatDateTime(s.createdAt, lang)}</bdi>
                  </td>
                  <td className="num">
                    <bdi>{formatMoney(s.grandTotal, lang)}</bdi>
                    {s.refundedTotal !== '0.00' && (
                      <div className="muted">
                        {t('sales.refunded')}: <bdi>{formatMoney(s.refundedTotal, lang)}</bdi>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${s.status === 'COMPLETED' ? '' : 'warn'}`}>
                      {t(`sales.status.${s.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <button type="button" className="btn-ghost" onClick={() => void more()}>
          {t('products.more')}
        </button>
      )}
    </section>
  );
}
