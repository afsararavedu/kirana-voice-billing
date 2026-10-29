import { LANGUAGE_NATIVE_NAMES, UI_LANGUAGES, type UiLanguage } from '@kirana/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

export function LanguageSwitcher({ onChange }: { onChange: (lang: UiLanguage) => void | Promise<void> }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  return (
    <div className="lang-switcher">
      <label htmlFor={id}>{t('lang.label')}</label>
      <select id={id} value={i18n.language} onChange={(e) => void onChange(e.target.value as UiLanguage)}>
        {UI_LANGUAGES.map((l) => (
          // Each option renders in its own language and direction.
          <option key={l} value={l} lang={l} dir="auto">
            {LANGUAGE_NATIVE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
