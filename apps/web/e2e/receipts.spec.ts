import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

/** Registers, creates a store, seeds products and makes one cash bill through the API. */
async function setup(page: Page, tag: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Ravi');
  await page.getByLabel('Email').fill(`e2e-rcpt-${tag}-${Date.now()}@example.in`);
  await page.getByLabel('Password').fill('a sufficiently long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your stores' })).toBeVisible();

  return page.evaluate(async () => {
    const call = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`/api/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const { store } = await call('POST', '/stores', { name: 'Lakshmi Kirana' });
    const { product: rice } = await call('POST', `/stores/${store.id}/products`, {
      name: 'Rice',
      localNames: { te: 'బియ్యం', ur: 'چاول' },
      unit: 'KG',
      sellingPrice: '62',
      taxRate: '5',
      openingStock: '10',
      lowStockThreshold: '9',
    });
    await call('POST', `/stores/${store.id}/products`, { name: 'Zeera', unit: 'PACK', sellingPrice: '20' });
    const items = [{ productId: rice.id, quantity: '1.5' }];
    const { quote } = await call('POST', `/stores/${store.id}/sales/quote`, { items });
    const total = quote.totals.grandTotal as string;
    const { sale } = await call(
      'POST',
      `/stores/${store.id}/sales`,
      { items, payments: [{ method: 'CASH', amount: total, tendered: '100' }], expectedGrandTotal: total },
      { 'Idempotency-Key': crypto.randomUUID() },
    );
    return { storeId: store.id as string, saleId: sale.id as string };
  });
}

test('owner sets store details, then prints a Telugu tax invoice and reprints it in Urdu', async ({
  page,
}, info) => {
  const { storeId, saleId } = await setup(page, info.project.name);

  // Details for the next bills; the existing bill keeps the details it was made with.
  await page.goto(`/stores/${storeId}`);
  await page.getByLabel('Receipt language').selectOption('te');
  await page.getByLabel('Address').fill('Main Road, Warangal');
  await page.getByLabel('GSTIN').fill('36aabcu9603r1zo');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByLabel('GSTIN')).toHaveValue('36AABCU9603R1ZO');
  await expectNoHorizontalOverflow(page);

  // Bill #1 was made before the GSTIN existed: a plain bill, in English (its receipt language).
  await page.goto(`/stores/${storeId}/sales/${saleId}`);
  await expect(page.getByTestId('sale-invoice')).toHaveText(/^\d\d-\d\d\/1$/);
  await page.getByRole('link', { name: 'Print receipt' }).click();
  const receipt = page.getByTestId('receipt');
  await expect(receipt).toHaveAttribute('lang', 'en');
  await expect(receipt.getByText('Bill', { exact: true })).toBeVisible();
  await expect(page.getByTestId('receipt-total')).toHaveText('₹93.00');

  // Reprint in Urdu: right-to-left, local item name, figures unchanged.
  await page.getByLabel('Receipt language').selectOption('ur');
  await expect(receipt).toHaveAttribute('dir', 'rtl');
  await expect(receipt.getByText('چاول')).toBeVisible();
  await expect(page.getByTestId('receipt-total')).toHaveText('₹93.00');
  await expectNoHorizontalOverflow(page);

  // The print button opens the browser's print dialog (stubbed here).
  await page.evaluate(() => {
    window.print = () => document.body.setAttribute('data-printed', 'yes');
  });
  await page.getByRole('button', { name: 'Print' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');

  // A new bill picks up the GSTIN and the Telugu receipt language.
  const second = await page.evaluate(async (id) => {
    const items = [{ productId: '', quantity: '1' }];
    const list = await fetch(`/api/v1/stores/${id}/products?q=rice`).then((r) => r.json());
    items[0]!.productId = list.products[0].id;
    const { quote } = await fetch(`/api/v1/stores/${id}/sales/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }).then((r) => r.json());
    const res = await fetch(`/api/v1/stores/${id}/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        items,
        payments: [{ method: 'UPI', amount: quote.totals.grandTotal }],
        expectedGrandTotal: quote.totals.grandTotal,
      }),
    }).then((r) => r.json());
    return res.sale.id as string;
  }, storeId);
  await page.goto(`/stores/${storeId}/sales/${second}/receipt`);
  await expect(receipt).toHaveAttribute('lang', 'te');
  await expect(receipt.getByText('ట్యాక్స్ ఇన్వాయిస్')).toBeVisible();
  await expect(receipt.getByText('36AABCU9603R1ZO')).toBeVisible();
  await expect(receipt.getByText('బియ్యం')).toBeVisible();
  await expect(page.getByTestId('receipt-invoice')).toHaveText(/^\d\d-\d\d\/2$/);
});

test('daily sales, low stock and the activity log', async ({ page }, info) => {
  const { storeId } = await setup(page, `rep-${info.project.name}`);

  await page.goto(`/stores/${storeId}`);
  await page.getByRole('link', { name: 'Daily sales' }).click();
  await expect(page.getByTestId('report-bills')).toHaveText('1');
  await expect(page.getByTestId('report-net')).toHaveText('₹93.00');
  await expect(page.getByTestId('report-net-CASH')).toHaveText('₹93.00');
  await expectNoHorizontalOverflow(page);

  await page.goto(`/stores/${storeId}`);
  await page.getByRole('link', { name: 'Low stock' }).click();
  const rows = page.locator('tbody tr');
  // Out of stock first, then Rice: 10 − 1.5 = 8.5 kg, 0.5 below its alert level of 9.
  await expect(rows.nth(0)).toContainText('Zeera');
  await expect(rows.nth(0)).toContainText('Out of stock');
  await expect(rows.nth(1)).toContainText('Rice');
  await expect(rows.nth(1)).toContainText('8.5 kg');
  await expect(rows.nth(1)).toContainText('0.5 kg');
  await expectNoHorizontalOverflow(page);

  await page.goto(`/stores/${storeId}`);
  await page.getByRole('link', { name: 'Activity log' }).click();
  await expect(page.getByRole('link', { name: 'Bill made' })).toBeVisible();
  await page.getByLabel('Show').selectOption('Product');
  await expect(page.getByRole('link', { name: 'Bill made' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Product added' }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
