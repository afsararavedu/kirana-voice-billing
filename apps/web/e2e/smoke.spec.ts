import { expect, test } from '@playwright/test';

test('register → create store → switch to Urdu (RTL) → language persists after reload', async ({
  page,
}, info) => {
  const email = `e2e-${info.project.name}-${Date.now()}@example.in`;

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Ravi');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a sufficiently long password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Your stores' })).toBeVisible();
  await expect(page.getByText('You have no stores yet.')).toBeVisible();

  await page.getByLabel('Store name').fill('Lakshmi Kirana');
  await page.getByRole('button', { name: 'Create store' }).click();
  await expect(page.getByText('Lakshmi Kirana')).toBeVisible();

  await page.getByLabel('Language').first().selectOption('ur');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'آپ کی دکانیں' })).toBeVisible();

  // Saved server-side: survives reload and overrides any local default.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('Lakshmi Kirana')).toBeVisible();

  // Open store; receipt language is independent of UI language.
  await page.getByRole('link', { name: 'کھولیں' }).click();
  await expect(page.getByRole('heading', { name: 'Lakshmi Kirana' })).toBeVisible();
  await page.getByLabel('رسید کی زبان').selectOption('te');
  await page.getByRole('button', { name: 'محفوظ کریں' }).click();
  await expect(page.getByText('محفوظ ہو گیا')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
});

test('unauthenticated users are sent to sign in', async ({ page }) => {
  await page.goto('/stores');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
