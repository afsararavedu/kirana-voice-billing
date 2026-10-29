import type { LowStockItemDto, UiLanguage } from '@kirana/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';
import { formatQty } from '../../lib/format';

export function LowStockPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { storeId = '' } = useParams();
  const [items, setItems] = useState<LowStockItemDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .lowStock(storeId)
      .then((r) => setItems(r.items))
      .catch(setError);
  }, [storeId]);

  const qty = (q: string, unit: LowStockItemDto['product']['unit']) => (
    <bdi>
      {formatQty(q, lang)} {t(`units.${unit}`)}
    </bdi>
  );

  return (
    <section className="card">
      <p>
        <Link to={`/stores/${storeId}`}>{t('store.back')}</Link>
      </p>
      <h1>{t('reports.lowStockTitle')}</h1>
      <ErrorText error={error} />
      {items === null && !error && <p role="status">{t('common.loading')}</p>}
      {items?.length === 0 && <p>{t('reports.lowStockEmpty')}</p>}
      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('reports.product')}</th>
                <th scope="col" className="num">
                  {t('products.stock')}
                </th>
                <th scope="col" className="num">
                  {t('reports.alertAt')}
                </th>
                <th scope="col" className="num">
                  {t('reports.shortBy')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ product: p, shortfall, outOfStock }) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/stores/${storeId}/products/${p.id}`}>
                      <bdi>{p.name}</bdi>
                    </Link>
                    {p.localNames[lang] && p.localNames[lang] !== p.name && (
                      <div lang={lang} dir="auto" className="muted">
                        {p.localNames[lang]}
                      </div>
                    )}
                    {outOfStock && <span className="badge warn">{t('reports.outOfStock')}</span>}
                  </td>
                  <td className="num">{qty(p.stockQuantity, p.unit)}</td>
                  <td className="num">{p.lowStockThreshold ? qty(p.lowStockThreshold, p.unit) : '—'}</td>
                  <td className="num">{shortfall ? qty(shortfall, p.unit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
