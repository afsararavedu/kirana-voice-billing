import {
  LANGUAGE_NATIVE_NAMES,
  RECEIPT_LANGUAGES,
  type ReceiptLanguage,
  type StoreDto,
  type UpdateStoreRequest,
} from '@kirana/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { ErrorText } from '../components/ErrorText';

/** Seller details printed on receipts. Only the owner may change them. */
function StoreDetailsForm({ store, onSaved }: { store: StoreDto; onSaved: (s: StoreDto) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwner = store.role === 'OWNER';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const body: UpdateStoreRequest = {
      name: text('name'),
      receiptLanguage: text('receiptLanguage') as ReceiptLanguage,
      address: text('address'),
      phone: text('phone'),
      gstin: text('gstin'),
      receiptFooter: text('receiptFooter'),
    };
    // Sent only when changed: the prefix is locked once this financial year has a bill.
    if (text('invoicePrefix').toUpperCase() !== (store.invoicePrefix ?? '')) {
      body.invoicePrefix = text('invoicePrefix');
    }
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const updated = (await api.updateStore(store.id, body)).store;
      // Show what the server stored (e.g. GSTIN upper-cased, blanks cleared).
      for (const k of ['name', 'address', 'phone', 'gstin', 'invoicePrefix', 'receiptFooter'] as const) {
        const input = form.elements.namedItem(k);
        if (input instanceof HTMLInputElement) input.value = updated[k] ?? '';
      }
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <fieldset className="form" disabled={!isOwner || busy}>
        <label>
          {t('stores.name')}
          <input name="name" defaultValue={store.name} required maxLength={120} dir="auto" />
        </label>
        <label className="field">
          {t('store.receiptLanguage')}
          <select name="receiptLanguage" defaultValue={store.receiptLanguage} aria-describedby="receipt-hint">
            {RECEIPT_LANGUAGES.map((l) => (
              <option key={l} value={l} lang={l}>
                {LANGUAGE_NATIVE_NAMES[l]}
              </option>
            ))}
          </select>
          <small id="receipt-hint">{t('store.receiptHint')}</small>
        </label>
        <label>
          {t('store.address')}
          <input name="address" defaultValue={store.address ?? ''} maxLength={300} dir="auto" />
        </label>
        <div className="grid-3">
          <label>
            {t('store.phone')}
            <input name="phone" type="tel" defaultValue={store.phone ?? ''} maxLength={20} dir="ltr" />
          </label>
          <label className="field">
            {t('store.gstin')}
            <input
              name="gstin"
              defaultValue={store.gstin ?? ''}
              maxLength={15}
              dir="ltr"
              autoCapitalize="characters"
              pattern="[0-9A-Za-z]{15}"
              aria-describedby="gstin-hint"
            />
            <small id="gstin-hint">{t('store.gstinHint')}</small>
          </label>
          <label className="field">
            {t('store.invoicePrefix')}
            <input
              name="invoicePrefix"
              defaultValue={store.invoicePrefix ?? ''}
              maxLength={4}
              dir="ltr"
              autoCapitalize="characters"
              pattern="[0-9A-Za-z]{1,4}"
              aria-describedby="prefix-hint"
            />
            <small id="prefix-hint">{t('store.invoicePrefixHint')}</small>
          </label>
        </div>
        <label>
          {t('store.receiptFooter')}
          <input
            name="receiptFooter"
            defaultValue={store.receiptFooter ?? ''}
            maxLength={200}
            dir="auto"
            placeholder={t('receipt.thanks')}
          />
        </label>
        {isOwner && (
          <p>
            <button type="submit">{t('common.save')}</button>
          </p>
        )}
      </fieldset>
      <ErrorText error={error} />
      {saved && <p role="status">{t('common.saved')}</p>}
    </form>
  );
}

export function StorePage() {
  const { t } = useTranslation();
  const { storeId = '' } = useParams();
  const [store, setStore] = useState<StoreDto | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .getStore(storeId)
      .then((r) => setStore(r.store))
      .catch(setError);
  }, [storeId]);

  const canManage = store?.role === 'OWNER' || store?.role === 'MANAGER';

  return (
    <div className="stack">
      <section className="card">
        <p>
          <Link to="/stores">{t('store.back')}</Link>
        </p>
        {!store && !error && <p role="status">{t('common.loading')}</p>}
        <ErrorText error={error} />
        {store && (
          <>
            <h1>
              <bdi>{store.name}</bdi>
            </h1>
            <p className="actions">
              <Link className="btn" to={`/stores/${store.id}/billing`}>
                {t('billing.title')}
              </Link>
              <Link className="btn btn-ghost" to={`/stores/${store.id}/sales`}>
                {t('sales.title')}
              </Link>
              <Link className="btn btn-ghost" to={`/stores/${store.id}/products`}>
                {t('store.products')}
              </Link>
            </p>
            <h2>{t('store.reports')}</h2>
            <p className="actions">
              {canManage && (
                <Link className="btn btn-ghost" to={`/stores/${store.id}/reports/daily`}>
                  {t('reports.dailyTitle')}
                </Link>
              )}
              <Link className="btn btn-ghost" to={`/stores/${store.id}/reports/low-stock`}>
                {t('reports.lowStockTitle')}
              </Link>
              {canManage && (
                <Link className="btn btn-ghost" to={`/stores/${store.id}/audit`}>
                  {t('audit.title')}
                </Link>
              )}
            </p>
            <p className="muted">{t('store.comingSoon')}</p>
          </>
        )}
      </section>
      {store && (
        <section className="card">
          <h2>{t('store.detailsTitle')}</h2>
          <p className="muted">{t('store.detailsHint')}</p>
          <StoreDetailsForm key={store.id} store={store} onSaved={setStore} />
        </section>
      )}
    </div>
  );
}
