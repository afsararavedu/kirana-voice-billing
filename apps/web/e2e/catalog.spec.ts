import { expect, test, type Page } from '@playwright/test';

async function registerWithStore(page: Page, tag: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Ravi');
  await page.getByLabel('Email').fill(`e2e-cat-${tag}-${Date.now()}@example.in`);
  await page.getByLabel('Password').fill('a sufficiently long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Store name').fill('Lakshmi Kirana');
  await page.getByRole('button', { name: 'Create store' }).click();
  await page.getByRole('link', { name: 'Open' }).click();
  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
}

test('add product → receive → damage → count → ledger, with exact decimals', async ({ page }, info) => {
  await registerWithStore(page, info.project.name);

  await page.getByRole('link', { name: 'Add product' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Toor Dal');
  await page.getByLabel('Name in తెలుగు').fill('కంది పప్పు');
  await page.getByLabel('Other names').fill('tuvar, arhar');
  await page.getByLabel('Selling price').fill('140.50');
  await page.getByLabel('GST rate').selectOption('5');
  await page.getByLabel('Opening stock').fill('10');
  await page.getByLabel('Low-stock alert at').fill('2');
  await page.getByRole('button', { name: 'Create product' }).click();

  await expect(page.getByRole('heading', { name: 'Toor Dal' })).toBeVisible();
  const stock = page.getByTestId('stock-qty');
  await expect(stock).toHaveText('10 kg');

  const record = async (kind: string, qty: string, note?: string) => {
    // A <select> nested in its <label> is named "label + selected option", hence the prefix match.
    await page.getByRole('combobox', { name: /^Change/ }).selectOption({ label: kind });
    await page.locator('input[name="qty"]').fill(qty);
    if (note) await page.locator('input[name="note"]').fill(note);
    await page.getByRole('button', { name: 'Record' }).click();
  };

  await record('Received from supplier', '2.125');
  await expect(stock).toHaveText('12.125 kg');
  await record('Damaged', '0.125');
  await expect(stock).toHaveText('12 kg');
  await record('Stock count', '11.5');
  await expect(stock).toHaveText('11.5 kg');
  await record('Damaged', '50');
  await expect(page.getByRole('alert')).toHaveText('Not enough stock for this change');
  await expect(stock).toHaveText('11.5 kg');

  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Stock count');
  await expect(rows.nth(0)).toContainText('-0.5');
  await expect(rows.nth(3)).toContainText('Opening stock');

  // Search by Telugu name from the product list.
  await page.getByRole('link', { name: 'Products' }).click();
  await page.getByLabel('Search products').fill('కంది');
  await expect(page.getByRole('link', { name: 'Toor Dal' })).toBeVisible();
  await expect(page.locator('table')).toContainText('₹140.50');
  await page.getByLabel('Search products').fill('sugar');
  await expect(page.getByText('No products match your search.')).toBeVisible();
});

test('CSV import shows row errors, then imports a valid file', async ({ page }, info) => {
  await registerWithStore(page, `imp-${info.project.name}`);
  await page.getByRole('link', { name: 'Import CSV' }).click();

  const upload = (name: string, csv: string) =>
    page.getByLabel('CSV file').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });

  await upload('bad.csv', 'name,unit,selling_price\nEggs,PIECE,6.555\n');
  await expect(page.getByRole('alert')).toContainText('Problems found (1)');
  await expect(page.locator('table')).toContainText('selling_price');

  await upload('good.csv', 'name,unit,selling_price,opening_stock\nSugar,KG,44,25\nSoap,PIECE,30,12\n');
  await expect(page.getByText('2 rows ready to import')).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 products' }).click();
  await expect(page.getByText('Imported 2 products.')).toBeVisible();

  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('link', { name: 'Sugar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Soap' })).toBeVisible();
});
