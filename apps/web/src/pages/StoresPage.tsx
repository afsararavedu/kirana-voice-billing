import type { StoreDto } from '@kirana/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ErrorText } from '../components/ErrorText';

export function StoresPage() {
  const { t } = useTranslation();
  const [stores, setStores] = useState<StoreDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listStores()
      .then((r) => setStores(r.stores))
      .catch(setError);
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    try {
      const { store } = await api.createStore({
        name: String(new FormData(form).get('name')),
        receiptLanguage: 'en',
      });
      setStores((s) => [...(s ?? []), store]);
      form.reset();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h1>{t('stores.title')}</h1>
        {stores === null && !error && <p role="status">{t('common.loading')}</p>}
        {stores?.length === 0 && <p>{t('stores.empty')}</p>}
        {stores && stores.length > 0 && (
          <ul className="store-list">
            {stores.map((s) => (
              <li key={s.id}>
                {/* <bdi> isolates user-entered names from the surrounding text direction. */}
                <bdi className="store-name">{s.name}</bdi>
                <span className="badge">{t(`stores.role.${s.role}`)}</span>
                <Link to={`/stores/${s.id}`}>{t('stores.open')}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{t('stores.createTitle')}</h2>
        <form onSubmit={onCreate} className="form inline">
          <label>
            {t('stores.name')}
            <input name="name" dir="auto" maxLength={120} required />
          </label>
          <button type="submit" disabled={busy}>
            {t('stores.create')}
          </button>
        </form>
        <ErrorText error={error} />
      </section>
    </div>
  );
}
