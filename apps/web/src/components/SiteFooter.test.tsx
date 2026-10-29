import { UI_LANGUAGES } from '@kirana/shared';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import i18n, { setUiLanguage } from '../i18n';
import { SiteFooter } from './Layout';

describe('SiteFooter', () => {
  afterEach(() => setUiLanguage('en'));

  it.each(UI_LANGUAGES)('%s: copyright, site link and developer credit', async (lang) => {
    await setUiLanguage(lang);
    render(
      <I18nextProvider i18n={i18n}>
        <SiteFooter />
      </I18nextProvider>,
    );
    const footer = screen.getByRole('contentinfo');
    // Brand names are never translated.
    expect(footer).toHaveTextContent(`© ${new Date().getFullYear()} Waycup Chai`);
    expect(footer).toHaveTextContent('ARM Gen Alpha Technologies');
    const link = screen.getByRole('link', { name: 'waycupchai.com' });
    expect(link).toHaveAttribute('href', 'https://waycupchai.com');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
