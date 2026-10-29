/**
 * Three independent language settings (see CLAUDE.md "Voice and language behavior"):
 * - UI language: what the app chrome is rendered in, per user.
 * - Speech input locale: BCP-47 locale passed to the speech provider, per user.
 * - Receipt language: what printed receipts use, per store.
 */
export const UI_LANGUAGES = ['en', 'hi', 'te', 'ur'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const RTL_LANGUAGES: ReadonlySet<UiLanguage> = new Set<UiLanguage>(['ur']);

export function textDirection(lang: UiLanguage): 'rtl' | 'ltr' {
  return RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
}

export const SPEECH_LOCALES = ['en-IN', 'hi-IN', 'te-IN', 'ur-IN'] as const;
export type SpeechLocale = (typeof SPEECH_LOCALES)[number];

export const RECEIPT_LANGUAGES = UI_LANGUAGES;
export type ReceiptLanguage = UiLanguage;

/** Native-script names, so a user can find their language regardless of the current UI language. */
export const LANGUAGE_NATIVE_NAMES: Record<UiLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  te: 'తెలుగు',
  ur: 'اردو',
};
