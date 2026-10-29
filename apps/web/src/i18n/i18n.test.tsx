import { UI_LANGUAGES } from '@kirana/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import i18n, { resources, setUiLanguage } from './index';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('locales', () => {
  const english = keys(resources.en.translation).sort();

  it.each(UI_LANGUAGES.filter((l) => l !== 'en'))('%s has exactly the English keys', (lang) => {
    expect(keys(resources[lang].translation).sort()).toEqual(english);
  });

  it.each(UI_LANGUAGES)('%s has no empty strings', (lang) => {
    const flat = JSON.stringify(resources[lang].translation);
    expect(flat).not.toMatch(/:""/);
  });
});

describe('document language and direction', () => {
  beforeEach(() => setUiLanguage('en'));

  it('switches <html> to rtl for Urdu and back to ltr', async () => {
    await setUiLanguage('ur');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ur');
    await setUiLanguage('te');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('te');
  });

  it('LanguageSwitcher changes the rendered language', async () => {
    let chosen = '';
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher
          onChange={async (l) => {
            chosen = l;
            await setUiLanguage(l);
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox'), 'hi');
    expect(chosen).toBe('hi');
    expect(await screen.findByLabelText('भाषा')).toBeInTheDocument();
  });
});
