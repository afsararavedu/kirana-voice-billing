import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';

/** Shows a localized message for an API error code; server message text is never shown raw. */
export function ErrorText({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  if (!error) return null;
  const code =
    error instanceof ApiError && i18n.exists(`errors.${error.code}`, { lng: 'en' }) ? error.code : 'generic';
  return (
    <p className="error" role="alert">
      {t(`errors.${code}`)}
    </p>
  );
}
