import { AUDIT_ENTITY_TYPES, type AuditEntryDto, type UiLanguage } from '@kirana/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { ErrorText } from '../components/ErrorText';
import { formatDateTime } from '../lib/format';

/** "price: 10 → 12, name: Dal" — raw field names; values are shown as text, never as markup. */
function describe(metadata: Record<string, unknown>): string {
  const show = (v: unknown) =>
    v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return Object.entries(metadata)
    .map(([k, v]) =>
      v && typeof v === 'object' && 'from' in v && 'to' in v
        ? `${k}: ${show(v.from)} → ${show(v.to)}`
        : `${k}: ${show(v)}`,
    )
    .join(' · ');
}

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { storeId = '' } = useParams();
  const [entityType, setEntityType] = useState('');
  const [entries, setEntries] = useState<AuditEntryDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setEntries(null);
    setError(null);
    api
      .auditLog(storeId, { entityType: entityType || undefined })
      .then((r) => {
        if (!live) return;
        setEntries(r.entries);
        setNext(r.nextBefore);
      })
      .catch((e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [storeId, entityType]);

  async function more() {
    if (!next) return;
    try {
      const r = await api.auditLog(storeId, { before: next, entityType: entityType || undefined });
      setEntries((e) => [...(e ?? []), ...r.entries]);
      setNext(r.nextBefore);
    } catch (e) {
      setError(e);
    }
  }

  const actionLabel = (action: string) => {
    const key = `audit.actions.${action.replace(/\./g, '_')}`;
    return i18n.exists(key) ? t(key) : action;
  };
  const target = (e: AuditEntryDto) => {
    if (!e.entityId) return null;
    if (e.entityType === 'Sale') return `/stores/${storeId}/sales/${e.entityId}`;
    if (e.entityType === 'Product') return `/stores/${storeId}/products/${e.entityId}`;
    return null;
  };

  return (
    <section className="card">
      <p>
        <Link to={`/stores/${storeId}`}>{t('store.back')}</Link>
      </p>
      <div className="page-head">
        <h1>{t('audit.title')}</h1>
        <label>
          {t('audit.filter')}
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">{t('audit.all')}</option>
            {AUDIT_ENTITY_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`audit.entity.${x}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorText error={error} />
      {entries === null && !error && <p role="status">{t('common.loading')}</p>}
      {entries?.length === 0 && <p>{t('audit.empty')}</p>}
      {entries && entries.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('audit.when')}</th>
                <th scope="col">{t('audit.who')}</th>
                <th scope="col">{t('audit.what')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const href = target(e);
                return (
                  <tr key={e.id}>
                    <td>
                      <bdi>{formatDateTime(e.createdAt, lang)}</bdi>
                    </td>
                    <td>
                      <bdi>{e.actor?.displayName ?? t('audit.unknownUser')}</bdi>
                    </td>
                    <td>
                      {href ? <Link to={href}>{actionLabel(e.action)}</Link> : actionLabel(e.action)}
                      {Object.keys(e.metadata).length > 0 && (
                        <div className="muted audit-details" dir="auto">
                          {describe(e.metadata)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
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
