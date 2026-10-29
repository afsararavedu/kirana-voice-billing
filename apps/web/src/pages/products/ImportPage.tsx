import { IMPORT_COLUMNS, type ImportRowError } from '@kirana/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api, ApiError, type ImportResult } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';

const MAX_FILE_BYTES = 1_500_000;

export function ImportPage() {
  const { t } = useTranslation();
  const { storeId = '' } = useParams();
  const [csv, setCsv] = useState<string | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setCheck(null);
    setDone(null);
    setError(null);
    if (!file) return setCsv(null);
    if (file.size > MAX_FILE_BYTES) return setError(new ApiError(413, 'IMPORT_TOO_LARGE', ''));
    const text = await file.text();
    setCsv(text);
    await run(text, true);
  }

  async function run(text: string, dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importProducts(storeId, text, dryRun);
      if (dryRun) setCheck(r);
      else {
        setDone(r.imported);
        setCheck(null);
        setCsv(null);
      }
    } catch (e) {
      // Row-level problems come back with the 422; show them like a dry run.
      if (e instanceof ApiError && e.code === 'IMPORT_INVALID') setCheck(e.details as ImportResult);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  const errors: ImportRowError[] = check?.errors ?? [];

  return (
    <section className="card">
      <p>
        <Link to={`/stores/${storeId}/products`}>{t('products.title')}</Link>
      </p>
      <h1>{t('import.title')}</h1>
      <p className="muted">{t('import.help')}</p>
      <pre className="code" dir="ltr">
        {IMPORT_COLUMNS.join(',')}
      </pre>

      <label className="field">
        {t('import.file')}
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>

      {busy && <p role="status">{t('common.loading')}</p>}
      <ErrorText error={error} />
      {done !== null && <p role="status">{t('import.done', { count: done })}</p>}

      {check && (
        <>
          {check.totalErrors === 0 ? (
            <>
              <p role="status">{t('import.valid', { count: check.valid })}</p>
              <button type="button" disabled={busy || !csv} onClick={() => csv && void run(csv, false)}>
                {t('import.run', { count: check.valid })}
              </button>
            </>
          ) : (
            <>
              <h2 role="alert">{t('import.errorsTitle', { count: check.totalErrors })}</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col" className="num">
                        {t('import.row')}
                      </th>
                      <th scope="col">{t('import.field')}</th>
                      <th scope="col">{t('import.problem')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((e, i) => (
                      <tr key={i}>
                        <td className="num">{e.row}</td>
                        <td dir="ltr">{e.field}</td>
                        {/* Validation messages are English from the server; isolated for RTL. */}
                        <td>
                          <bdi dir="ltr">{e.message}</bdi>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
