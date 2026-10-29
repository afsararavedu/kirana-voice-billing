import { LANGUAGE_NATIVE_NAMES, SPEECH_LOCALES, type SpeechLocale } from '@kirana/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { ErrorText } from '../components/ErrorText';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

const speechLabel = (l: SpeechLocale) =>
  LANGUAGE_NATIVE_NAMES[l.slice(0, 2) as keyof typeof LANGUAGE_NATIVE_NAMES];

export function SettingsPage() {
  const { t } = useTranslation();
  const { user, updatePreferences, changeLanguage } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  if (!user) return null;

  async function run(fn: () => Promise<void>) {
    setSaved(false);
    setError(null);
    try {
      await fn();
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="card">
      <h1>{t('settings.title')}</h1>
      <div className="form">
        <div className="field">
          <span>{t('settings.uiLanguage')}</span>
          <LanguageSwitcher onChange={(lang) => run(() => changeLanguage(lang))} />
        </div>
        <label className="field">
          {t('settings.speechLocale')}
          <select
            value={user.speechLocale}
            onChange={(e) =>
              void run(() => updatePreferences({ speechLocale: e.target.value as SpeechLocale }))
            }
            aria-describedby="speech-hint"
          >
            {SPEECH_LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>
                {speechLabel(l)} ({l})
              </option>
            ))}
          </select>
          <small id="speech-hint">{t('settings.speechHint')}</small>
        </label>
      </div>
      {saved && <p role="status">{t('common.saved')}</p>}
      <ErrorText error={error} />
    </section>
  );
}
