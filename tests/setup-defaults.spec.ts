import { expect, test } from '@playwright/test';

for (const width of [375, 768, 1280]) {
  test(`setup choices remain visible and independent at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#ai');
    const dialog = page.locator('dialog:has(.game-setup--ai)');
    const variant = dialog.locator('#sf_variant');
    await expect(variant).toHaveValue('standard');
    await expect(variant).toBeVisible();
    await expect(dialog.locator('#ai-color-white')).toBeChecked();
    await expect(dialog.locator('.ai-history h3')).toHaveText('My performance against Pikafish level 1');
    await dialog.locator('details.advanced-settings summary').click();
    const rules = dialog.locator('#sf_ruleset');
    for (const value of ['unrestricted-v1', 'tiantian-v1', 'unrestricted-v1']) {
      await rules.selectOption(value);
      await expect(rules).toHaveValue(value);
      await expect(rules).toBeVisible();
      await expect(rules).toHaveCSS('opacity', '1');
    }
    await page.screenshot({ path: `.tools/dialog-fixes/setup-${width}.png`, fullPage: true });
    await variant.selectOption('jieqi');
    await expect(rules).toHaveCount(0);
    await variant.selectOption('standard');
    await expect(rules).toBeVisible();
    await expect(dialog.locator('.lobby__start__button--ai')).toBeEnabled();
  });
}

test('saved Jieqi setup does not change ordinary game entry points', async ({ page }) => {
  await page.addInitScript(() => {
    for (const type of ['ai', 'hook', 'friend'])
      localStorage.setItem(
        `lobby.setup.anon.${type}`,
        JSON.stringify({
          variant: 'jieqi',
          fen: '',
          timeMode: 'realTime',
          time: 5,
          increment: 3,
          days: 2,
          color: 'black',
          aiLevel: 1,
          aiTimeControls: false,
        }),
      );
  });
  for (const type of ['ai', 'hook', 'friend']) {
    await page.goto(`/#${type}`);
    await expect(page.locator('#sf_variant')).toHaveValue('standard');
  }
  await page.goto('/?variant=jieqi#ai');
  await expect(page.locator('#sf_variant')).toHaveValue('jieqi');
  await page.locator('#sf_variant').selectOption('standard');
  await expect(page.locator('.lobby__start__button--ai')).toBeEnabled();
});

test('analysis restores the active Jieqi tab but new tabs default to Xiangqi', async ({ page }) => {
  await page.goto('/analysis');
  const variant = page.locator('.xiangqi-analysis-variant select');
  await expect(variant).toHaveValue('xiangqi');
  await variant.selectOption('jieqi');
  await expect(variant).toHaveValue('jieqi');
  await expect(page.locator('.xiangqi-analysis__tab')).toHaveCount(2);
  await page.reload();
  await expect(variant).toHaveValue('jieqi');
  await expect(page.locator('.xiangqi-analysis__tab')).toHaveCount(2);
  await page.getByRole('button', { name: 'New analysis tab', exact: true }).click();
  await expect(variant).toHaveValue('xiangqi');
  await expect(page.locator('.xiangqi-analysis__tab')).toHaveCount(3);
});

test('home puzzle action opens themes and leaderboard has no clipped visible rows', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.lobby__action--puzzle')).toHaveAttribute('href', '/training/themes');
  // Exercise overflow even when the preview has only a few established players.
  await page.locator('.lobby__leaderboard tbody').evaluate(body => {
    const first = body.querySelector('tr');
    if (!first) throw new Error('A ranked player is needed for the leaderboard fixture');
    for (let i = 0; i < 15; i++) {
      const row = first.cloneNode(true) as HTMLTableRowElement;
      row.classList.remove('is-me');
      row.hidden = false;
      row.querySelector('.lobby__leaderboard__place')!.textContent = String(100000 + i);
      body.append(row);
    }
  });
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const leaderboard = page.locator('.lobby__leaderboard');
    await expect(leaderboard).toBeVisible();
    await expect
      .poll(() =>
        leaderboard.evaluate(card => {
          const viewport = card.querySelector('.lobby__leaderboard__scroll')!;
          const bottom = viewport.getBoundingClientRect().bottom;
          return [...card.querySelectorAll<HTMLTableRowElement>('tbody tr')]
            .filter(row => !row.hidden)
            .every(row => row.getBoundingClientRect().bottom <= bottom + 1);
        }),
      )
      .toBe(true);
    for (const place of await leaderboard.locator('tbody tr:not([hidden]) .lobby__leaderboard__place').all())
      expect(await place.evaluate(cell => cell.scrollWidth <= cell.clientWidth)).toBe(true);
    await page.screenshot({ path: `.tools/dialog-fixes/home-${width}.png`, fullPage: true });
  }
});

test('profile variants have distinct symbols and separate labels', async ({ page }) => {
  await page.goto('/@/testing');
  const ranks = page.locator('.xiangqi-rank');
  await expect(ranks).toHaveCount(2);
  await expect(ranks.nth(0).locator('.variant-icon')).toHaveText('帥');
  await expect(ranks.nth(1).locator('.variant-icon')).toHaveText('揭');
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(ranks.nth(0).locator('h3')).toBeVisible();
    await page.screenshot({ path: `.tools/dialog-fixes/profile-${width}.png`, fullPage: true });
  }
});
