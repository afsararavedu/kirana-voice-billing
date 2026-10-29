import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

/** Registers, sets the speech language, creates a store and a small catalog through the API. */
async function setup(page: Page, tag: string, speechLocale = 'en-IN') {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Ravi');
  await page.getByLabel('Email').fill(`e2e-voice-${tag}-${Date.now()}@example.in`);
  await page.getByLabel('Password').fill('a sufficiently long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your stores' })).toBeVisible();

  return page.evaluate(async (locale) => {
    const call = (method: string, path: string, body: unknown) =>
      fetch(`/api/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    await call('PATCH', '/auth/me/preferences', { speechLocale: locale });
    const { store } = await call('POST', '/stores', { name: 'Lakshmi Kirana' });
    const p = (body: object) => call('POST', `/stores/${store.id}/products`, { openingStock: '20', ...body });
    await p({
      name: 'Rice',
      localNames: { te: 'బియ్యం', hi: 'चावल' },
      aliases: ['chawal'],
      unit: 'KG',
      sellingPrice: '62',
    });
    await p({ name: 'Lux Soap', unit: 'PIECE', sellingPrice: '35' });
    await p({ name: 'Dettol Soap', unit: 'PIECE', sellingPrice: '40' });
    await p({ name: 'Milk', aliases: ['doodh'], unit: 'PACK', sellingPrice: '30' });
    return store.id as string;
  }, speechLocale);
}

test('typed order → resolve look-alikes → server total → confirm → voice bill', async ({ page }, info) => {
  const storeId = await setup(page, info.project.name);
  await page.goto(`/stores/${storeId}/billing`);

  await page.getByLabel('What the customer said').fill('do kilo chawal, soap, ek packet doodh, saffron');
  await page.getByRole('button', { name: 'Find items' }).click();

  const lines = page.getByTestId('voice-line');
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(3)).toContainText('Not in your products');
  // "soap" matches two products: the cashier picks one and says how many.
  await lines.nth(1).locator('label', { hasText: 'Lux Soap' }).click();
  await page.getByLabel('Quantity soap').fill('2');
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Add 3 to bill' }).click();

  // Prices come from the catalog via the normal server quote: 2×62 + 2×35 + 30 = 224.
  await expect(page.getByLabel('Qty Rice')).toHaveValue('2');
  await expect(page.getByLabel('Qty Lux Soap')).toHaveValue('2');
  await expect(page.getByLabel('Qty Milk')).toHaveValue('1');
  await expect(page.getByTestId('grand-total')).toHaveText('₹224.00');
  await page.getByRole('button', { name: 'Confirm bill ₹224.00' }).click();

  await expect(page.getByRole('heading', { name: 'Bill #1' })).toBeVisible();
  await expect(page.getByTestId('sale-source')).toHaveText('Voice bill');
  await expect(page.getByTestId('sale-total')).toHaveText('₹224.00');
});

test('microphone path in Telugu (browser speech recognition stubbed)', async ({ page }, info) => {
  // Chrome's real recognizer needs a microphone and Google's service; this stand-in "hears" Telugu.
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = true;
      maxAlternatives = 0;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        document.body.dataset.speechLang = this.lang;
        setTimeout(() => {
          this.onresult?.({
            results: [Object.assign([{ transcript: 'రెండు కిలోల బియ్యం' }], { isFinal: true })],
          });
          this.onend?.();
        }, 50);
      }
      stop() {}
    }
    // Current Chromium exposes both names; the app prefers the unprefixed one.
    const w = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown };
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
  const storeId = await setup(page, `mic-${info.project.name}`, 'te-IN');
  await page.goto(`/stores/${storeId}/billing`);

  await page.getByRole('button', { name: 'Speak' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-speech-lang', 'te-IN');
  await expect(page.getByLabel('What the customer said')).toHaveValue('రెండు కిలోల బియ్యం');
  await page.getByRole('button', { name: 'Find items' }).click();
  await page.getByRole('button', { name: 'Add 1 to bill' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('₹124.00');
  // Manual billing still works alongside voice.
  await page.getByLabel('Find product').fill('milk');
  await page.getByRole('button', { name: /Milk/ }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('₹154.00');
  await expectNoHorizontalOverflow(page);
});
