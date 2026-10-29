import type { ProductDto, UiLanguage } from '@kirana/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';
import { formatMoney, formatQty, isLowStock } from '../../lib/format';
import { useStore } from '../../stores/useStore';

const SEARCH_DEBOUNCE_MS = 250;

export function ProductsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { storeId = '' } = useParams();
  const { store, canManage } = useStore(storeId);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [items, setItems] = useState<ProductDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .listProducts(storeId, { q: q.trim() || undefined, includeInactive: showArchived })
        .then((r) => {
          if (!live) return;
          setItems(r.products);
          setNextCursor(r.nextCursor);
          setError(null);
        })
        .catch((e: unknown) => live && setError(e));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [storeId, q, showArchived]);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const r = await api.listProducts(storeId, {
        q: q.trim() || undefined,
        includeInactive: showArchived,
        cursor: nextCursor,
      });
      setItems((prev) => [...(prev ?? []), ...r.products]);
      setNextCursor(r.nextCursor);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section className="card">
      <p>
        <Link to={`/stores/${storeId}`}>{store ? <bdi>{store.name}</bdi> : t('store.back')}</Link>
      </p>
      <div className="page-head">
        <h1>{t('products.title')}</h1>
        {canManage && (
          <div className="actions">
            <Link className="btn" to={`/stores/${storeId}/products/new`}>
              {t('products.add')}
            </Link>
            <Link className="btn btn-ghost" to={`/stores/${storeId}/products/import`}>
              {t('products.import')}
            </Link>
          </div>
        )}
      </div>

      <div className="toolbar">
        <label className="grow">
          {t('products.search')}
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            dir="auto"
            aria-describedby="search-hint"
          />
          <small id="search-hint">{t('products.searchHint')}</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('products.showArchived')}
        </label>
      </div>

      <ErrorText error={error} />
      {items === null && !error && <p role="status">{t('common.loading')}</p>}
      {items?.length === 0 && <p>{q ? t('products.noMatches') : t('products.empty')}</p>}

      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('product.name')}</th>
                <th scope="col" className="num">
                  {t('products.stock')}
                </th>
                <th scope="col" className="num">
                  {t('products.price')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const local = p.localNames[lang];
                const low = isLowStock(p.stockQuantity, p.lowStockThreshold);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/stores/${storeId}/products/${p.id}`}>
                        <bdi>{p.name}</bdi>
                      </Link>
                      {local && local !== p.name && (
                        <div lang={lang} dir="auto" className="muted">
                          {local}
                        </div>
                      )}
                      {!p.isActive && <span className="badge">{t('products.inactive')}</span>}
                    </td>
                    <td className="num">
                      <bdi>
                        {formatQty(p.stockQuantity, lang)} {t(`units.${p.unit}`)}
                      </bdi>
                      {low && <span className="badge warn">{t('products.lowStock')}</span>}
                    </td>
                    <td className="num">
                      <bdi>{formatMoney(p.sellingPrice, lang)}</bdi>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor && (
        <button type="button" className="btn-ghost" onClick={() => void loadMore()}>
          {t('products.more')}
        </button>
      )}
    </section>
  );
}
