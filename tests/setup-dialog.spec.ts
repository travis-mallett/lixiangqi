import { expect, test } from '@playwright/test';

const sizes = [
  { name: 'mobile-375', width: 375, height: 667 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 800 },
];

for (const size of sizes) {
  test(`computer setup remains reachable at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    await page.locator('.lobby__action--ai').click();

    const dialog = page.locator('dialog:has(.game-setup--ai)');
    await expect(dialog).toBeVisible();
    const advanced = dialog.locator('details.advanced-settings');
    await expect(advanced).toBeVisible();
    await advanced.locator('summary').click();

    const timing = dialog.locator('#ai-time-controls');
    await expect(timing).toBeVisible();
    if (!(await timing.isChecked())) await timing.check();
    await dialog.locator('#sf_move_time').check();
    await dialog.locator('#sf_move_time_first').check();

    const scrollable = dialog.locator(':scope > .scrollable');
    await scrollable.evaluate(el => (el.scrollTop = 0));
    await scrollable.hover();
    await page.mouse.wheel(0, 1200);
    const afterWheel = await scrollable.evaluate(el => ({
      height: el.scrollHeight,
      client: el.clientHeight,
    }));
    if (afterWheel.height > afterWheel.client)
      await expect.poll(() => scrollable.evaluate(el => el.scrollTop)).toBeGreaterThan(0);

    const start = dialog.locator('.lobby__start__button--ai');
    await expect(start).toBeVisible();
    const geometry = await start.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewport: window.innerHeight,
        hit: hit === el || el.contains(hit),
      };
    });
    expect(geometry.bottom).toBeLessThanOrEqual(size.height + 1);
    expect(geometry.top).toBeGreaterThanOrEqual(-1);
    expect(geometry.hit).toBe(true);

    const timingState = await timing.isChecked();
    await advanced.locator('summary').click();
    await advanced.locator('summary').click();
    expect(await timing.isChecked()).toBe(timingState);
    await page.setViewportSize({ width: size.width, height: Math.max(480, size.height - 160) });
    await expect(dialog).toBeVisible();
    await scrollable.evaluate(el => (el.scrollTop = 0));
    await scrollable.hover();
    await page.mouse.wheel(0, 1200);
    await expect
      .poll(() => start.evaluate(el => el.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(Math.max(480, size.height - 160) + 1);
  });
}

test.describe('touch dialog', () => {
  test.use({ hasTouch: true });
  test('swipe advances the computer setup scroll boundary', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Touch CDP coverage runs on Chromium only');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.locator('.lobby__action--ai').click();
    const dialog = page.locator('dialog:has(.game-setup--ai)');
    await dialog.locator('details.advanced-settings summary').click();
    await dialog.locator('#ai-time-controls').check();
    await dialog.locator('#sf_move_time').check();
    await dialog.locator('#sf_move_time_first').check();
    const scrollable = dialog.locator(':scope > .scrollable');
    await scrollable.evaluate(el => (el.scrollTop = 0));
    const client = await page.context().newCDPSession(page);
    const start = dialog.locator('.lobby__start__button--ai');
    for (let swipe = 0; swipe < 4; swipe++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 180, y: 560 }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 180, y: 160 }],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      if (await start.evaluate(el => el.getBoundingClientRect().bottom <= window.innerHeight)) break;
    }
    await expect.poll(() => start.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(667);
    await expect
      .poll(() =>
        start.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === el || el.contains(hit);
        }),
      )
      .toBe(true);
    await start.click({ trial: true });
  });
});

test('from-position setup opens Advanced Settings without resetting disclosure or timing state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fen = encodeURIComponent('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
  await page.goto(`/?fen=${fen}#ai`);

  const dialog = page.locator('dialog:has(.game-setup--ai)');
  await expect(dialog).toBeVisible();
  const advanced = dialog.locator('details.advanced-settings');
  await expect(advanced).toHaveAttribute('open', '');
  const timing = dialog.locator('#ai-time-controls');
  await expect(timing).not.toBeChecked();

  await advanced.locator('summary').click();
  await expect(advanced).not.toHaveAttribute('open', '');
  await advanced.locator('summary').click();
  await expect(advanced).toHaveAttribute('open', '');
  await expect(timing).not.toBeChecked();

  // Updating the variant prop redraws the form; the native disclosure state must survive it.
  await advanced.locator('.mselect__label').first().click();
  await advanced.locator('.mselect__item').first().click();
  await expect(advanced).toHaveAttribute('open', '');
  await expect(timing).not.toBeChecked();
});
