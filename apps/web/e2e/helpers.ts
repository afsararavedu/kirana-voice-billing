import { expect, type Page } from '@playwright/test';

/** The page itself must never be wider than the screen (phones otherwise zoom out). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { doc, vw } = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    vw: window.innerWidth,
  }));
  expect(doc, 'page wider than viewport').toBeLessThanOrEqual(vw);
}
