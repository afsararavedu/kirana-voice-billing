import { LANGUAGE_NATIVE_NAMES, RECEIPT_LANGUAGES, type ReceiptDto, type UiLanguage } from '@kirana/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { ErrorText } from '../../components/ErrorText';
import { Receipt } from '../../components/Receipt';

export function ReceiptPage() {
  const { t } = useTranslation();
  const { storeId = '', saleId = '' } = useParams();
  // undefined = the bill's own receipt language.
  const [lang, setLang] = useState<UiLanguage | undefined>(undefined);
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .getReceipt(storeId, saleId, lang)
      .then((r) => live && setReceipt(r.receipt))
      .catch((e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [storeId, saleId, lang]);

  return (
    <div className="stack">
      <section className="card no-print">
        <p>
          <Link to={`/stores/${storeId}/sales/${saleId}`}>{t('receiptPage.back')}</Link>
        </p>
        <div className="toolbar">
          <label>
            {t('receiptPage.language')}
            <select
              value={receipt?.language ?? ''}
              onChange={(e) => setLang(e.target.value as UiLanguage)}
              disabled={!receipt}
            >
              {RECEIPT_LANGUAGES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {LANGUAGE_NATIVE_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => window.print()} disabled={!receipt}>
            {t('receiptPage.print')}
          </button>
        </div>
        <ErrorText error={error} />
        {!receipt && !error && <p role="status">{t('common.loading')}</p>}
      </section>
      {receipt && <Receipt receipt={receipt} />}
    </div>
  );
}
