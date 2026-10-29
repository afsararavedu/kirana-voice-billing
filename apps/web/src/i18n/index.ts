import { textDirection, UI_LANGUAGES, type UiLanguage } from '@kirana/shared';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hi from './locales/hi.json';
import te from './locales/te.json';
import ur from './locales/ur.json';

export const resources = {
  en: { translation: en },
  hi: { translation: hi },
  te: { translation: te },
  ur: { translation: ur },
};

const STORAGE_KEY = 'kvb.uiLanguage';

export function isUiLanguage(v: unknown): v is UiLanguage {
  return typeof v === 'string' && (UI_LANGUAGES as readonly string[]).includes(v);
}

/** Remembered choice for signed-out visitors; signed-in users get theirs from the server. */
function initialLanguage(): UiLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isUiLanguage(saved)) return saved;
  } catch {
    // storage unavailable (private mode etc.)
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
  return isUiLanguage(nav) ? nav : 'en';
}

/** Keep <html lang/dir> in sync so the browser handles RTL layout, fonts and bidi correctly. */
export function applyDocumentLanguage(lang: UiLanguage): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = textDirection(lang);
}

export async function setUiLanguage(lang: UiLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

i18n.on('languageChanged', (lng) => {
  if (isUiLanguage(lng)) applyDocumentLanguage(lng);
});

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: [...UI_LANGUAGES],
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
});
applyDocumentLanguage((i18n.language as UiLanguage) ?? 'en');

export default i18n;
