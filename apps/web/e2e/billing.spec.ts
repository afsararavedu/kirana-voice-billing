import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

/** Registers, creates a store and seeds products through the API (same session cookie). */
async function setup(page: Page, tag: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Ravi');
  await page.getByLabel('Email').fill(`e2e-bill-${tag}-${Date.now()}@example.in`);
  await page.getByLabel('Password').fill('a sufficiently long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your stores' })).toBeVisible();

  return page.evaluate(async () => {
    const post = (path: string, body: unknown) =>
      fetch(`/api/v1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const { store } = await post('/stores', { name: 'Lakshmi Kirana' });
    await post(`/stores/${store.id}/products`, {
      name: 'Rice',
      localNames: { te: 'బియ్యం' },
      unit: 'KG',
      sellingPrice: '62',
      openingStock: '10',
    });
    await post(`/stores/${store.id}/products`, {
      name: 'Soap',
      unit: 'PIECE',
      sellingPrice: '30',
      taxRate: '18',
      openingStock: '2',
    });
    return store.id as string;
  });
}

test('bill → cash with change → partial return → stock reflects both', async ({ page }, info) => {
  const storeId = await setup(page, info.project.name);
  await page.goto(`/stores/${storeId}/billing`);

  // Search in Telugu, add, set a weighed quantity.
  await page.getByLabel('Find product').fill('బియ్యం');
  await page.getByRole('button', { name: /Rice/ }).click();
  await page.getByLabel('Qty Rice').fill('1.5');
  await expect(page.getByTestId('grand-total')).toHaveText('₹93.00');

  await page.getByLabel('Cash received').fill('100');
  await expect(page.getByTestId('change')).toHaveText('₹7.00');
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Confirm bill ₹93.00' }).click();

  await expect(page.getByRole('heading', { name: 'Bill #1' })).toBeVisible();
  await expect(page.getByTestId('sale-total')).toHaveText('₹93.00');
  await expect(page.getByTestId('sale-change')).toHaveText('₹7.00');
  await expect(page.getByTestId('sale-status')).toHaveText('Paid');

  // Return half a kilo.
  await page.getByLabel(/Rice/).fill('0.5');
  await page.getByLabel('Reason').fill('Spoiled');
  await page.getByRole('button', { name: 'Record return' }).click();
  await expect(page.getByTestId('sale-status')).toHaveText('Partly returned');
  await expect(page.getByTestId('sale-refunded')).toHaveText('−₹31.00');
  await expectNoHorizontalOverflow(page);

  // 10 − 1.5 + 0.5 = 9
  await page.goto(`/stores/${storeId}/products`);
  await expect(page.locator('table')).toContainText('9 kg');
  await expectNoHorizontalOverflow(page);

  await page.goto(`/stores/${storeId}/sales`);
  await expect(page.getByRole('link', { name: '#1' })).toBeVisible();
  await expect(page.locator('table')).toContainText('Partly returned');
});

test('counter blocks a bill that would oversell', async ({ page }, info) => {
  const storeId = await setup(page, `short-${info.project.name}`);
  await page.goto(`/stores/${storeId}/billing`);
  await page.getByLabel('Find product').fill('soap');
  await page.getByRole('button', { name: /Soap/ }).click();
  await page.getByLabel('Qty Soap').fill('3');
  await expect(page.getByText('Only 2 in stock')).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirm bill/ })).toBeDisabled();

  await page.getByLabel('Qty Soap').fill('2');
  await expect(page.getByTestId('grand-total')).toHaveText('₹60.00');
  // The radio is visually hidden inside a pill-shaped label; users tap the label.
  await page.locator('.segmented label', { hasText: 'UPI' }).click();
  await expect(page.getByRole('radio', { name: 'UPI' })).toBeChecked();
  await page.getByRole('button', { name: 'Confirm bill ₹60.00' }).click();
  await expect(page.getByRole('heading', { name: 'Bill #1' })).toBeVisible();
});
