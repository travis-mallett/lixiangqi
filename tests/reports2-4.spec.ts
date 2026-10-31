import { expect, test } from '@playwright/test';

const jieqiFen = 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w j - 0 1';
const fixture = `[Variant "Jieqi"]\n[FEN "${jieqiFen}"]\n[SetUp "1"]\n[Ruleset "jieqi-v1"]\n\n1. P1+1~soldier *`;

test('Jieqi import, draft reload and embed preserve the reveal', async ({ page, context }) => {
  await page.goto('/analysis');
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  await page.locator('.xiangqi-analysis-variant select').selectOption('jieqi');
  const notation = page.locator('#xiangqi-notation');
  await notation.fill(fixture);
  await page.locator('#xiangqi-import-notation').click();
  await expect(page.locator('#xiangqi-status')).toContainText('Black to move');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lixiangqi.analysis.tabs.v2')!));
  await page.reload();
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  await expect(page.locator('.xiangqi-analysis__tab')).toHaveCount(2);
  await expect(page.locator('#xiangqi-status')).toContainText('Black to move');
  await expect(notation).toHaveValue(/P1\+1~soldier/);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('lixiangqi.analysis.tabs.v2')!));
  expect(restored.activeId).toBe(saved.activeId);
  expect(restored.tabs.map((t: { id: string }) => t.id)).toEqual(saved.tabs.map((t: { id: string }) => t.id));
  await page.locator('.xiangqi-analysis__tab:not(.active) .xiangqi-analysis__tab-close').click();
  await page.reload();
  await expect(page.locator('.xiangqi-analysis__tab')).toHaveCount(1);
  await expect(page.locator('#xiangqi-status')).toContainText('Black to move');
  await expect(notation).toHaveValue(/P1\+1~soldier/);
  const before = await notation.inputValue();
  await page.getByRole('button', { name: 'Embed your game', exact: true }).click();
  const output = page.getByLabel('Embed HTML', { exact: true });
  await expect(output).toBeVisible();
  await expect(output).toHaveAttribute('readonly');
  await expect(notation).toHaveValue(before);
  const html = await output.inputValue();
  const src = /src="([^"]+)"/.exec(html)![1];
  await page.keyboard.press('Escape');
  await expect(output).not.toBeVisible();
  const embed = await context.newPage();
  await embed.goto(src);
  await embed.locator('move').first().click();
  await expect(embed.locator('piece.p-piece.white')).toHaveCount(1);
  await expect(embed.locator('.xiangqi-motion-piece')).toHaveCount(0, { timeout: 15_000 });
  const face = embed.locator('piece.p-piece.white');
  await expect(face).toBeVisible();
  await embed.screenshot({ path: '.tools/reports2-4/embed-soldier.png' });
  expect(await face.evaluate(el => window.getComputedStyle(el, '::after').backgroundImage)).toContain('rP');
});

test('custom analysis keyboard help opens from a button and closes with Escape', async ({ page }) => {
  await page.goto('/analysis');
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  await page.locator('#xiangqi-import-notation').focus();
  await page.keyboard.press('?');
  await expect(page.locator('dialog')).toContainText('Keyboard shortcuts');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).not.toBeVisible();
});

test('restored Jieqi embed with evaluations paints the revealed soldier', async ({ page }) => {
  const pgn = fixture.replace('1. P1+1~soldier *', ';[%eval 2.32,20]\n1. P1+1~soldier\n;[%eval 1.39,19]\n *');
  await page.goto(`/embed/xiangqi#${encodeURIComponent(JSON.stringify({ pgn }))}`);
  await page.locator('move').first().click();
  const soldier = page.locator('piece.p-piece.white');
  await expect(soldier).toHaveCount(1);
  await expect(page.locator('.xiangqi-motion-piece')).toHaveCount(0, { timeout: 15_000 });
  expect(await soldier.evaluate(el => window.getComputedStyle(el, '::after').backgroundImage)).toContain(
    'rP',
  );
});

test('finished replay retains player names and recorded outcome', async ({ page }) => {
  const gameId = process.env.REPORT_REPLAY_GAME || 'COwmHV7r';
  const exported = await page.request.get(`/game/export/${gameId}`);
  expect(exported.ok()).toBe(true);
  const original = await exported.text();
  const red = /\[Red "([^"]+)"\]/.exec(original)![1];
  await page.goto(`/${gameId}`);
  await expect(
    page.locator(
      '.xiangqi-analysis__tab-select.active, .xiangqi-analysis__tab.active .xiangqi-analysis__tab-select',
    ),
  ).toContainText(red);
  const notation = page.locator('#xiangqi-notation');
  await expect(notation).toHaveValue(/\[Red /);
  const replay = await notation.inputValue();
  for (const name of ['Red', 'Black', 'Result']) {
    const header = new RegExp(`\\[${name} "[^"]+"\\]`).exec(original)![0];
    expect(replay).toContain(header);
  }
});

test('Preferences submenus dismiss with Escape and restore trigger focus', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('#top .dasher .toggle');
  await toggle.click();
  const theme = page.locator('#dasher_app').getByText('UI Theme', { exact: true });
  await theme.click();
  await page.locator('#dasher_app button').first().focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dasher_app')).not.toBeVisible();
  await expect(toggle).toBeFocused();
});

test('per-move timing stays disabled after reopening computer setup', async ({ page }) => {
  await page.goto('/#ai');
  const dialog = page.locator('dialog:has(.game-setup--ai)');
  await dialog.locator('details.advanced-settings summary').click();
  await dialog.locator('#ai-time-controls').check();
  await dialog.locator('#sf_move_time').check();
  await dialog.locator('label[for="sf_move_time"]').click();
  await expect(dialog.locator('#sf_move_time')).not.toBeChecked();
  await expect(dialog.locator('.move-time-fields')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.locator('.lobby__action--ai').click();
  await page.getByRole('button', { name: 'Challenge a Higher Level', exact: true }).click();
  await dialog.locator('details.advanced-settings summary').click();
  await expect(dialog.locator('#sf_move_time')).not.toBeChecked();
});

test('export validates date ordering, maximum and hour-minute inputs', async ({ page }) => {
  await page.goto(`/@/${process.env.REPORT_EXPORT_USER || 'ChineseChessOutLoud'}/download`);
  const download = page.locator('#dl-button');
  await expect(download).toBeVisible();
  await page.locator('#dl-date-since').fill('2026-10-27');
  await page.locator('#dl-date-until').fill('2026-10-01');
  await expect(download).toBeDisabled();
  await expect(page.locator('#dl-error')).toContainText('start date');
  await page.locator('#dl-date-until').fill('2026-10-26');
  await expect(download).toBeDisabled();
  await page.locator('#dl-date-until').fill('2026-10-28');
  await expect(download).toBeEnabled();
  for (const max of ['0', '-1', '1.5']) {
    await page.locator('#dl-amount').fill(max);
    await expect(download).toBeDisabled();
  }
  await page.locator('#dl-amount').fill('1');
  await page.locator('#dl-date-until').fill('2026-10-27');
  await page.locator('#dl-time-since').fill('12:34');
  await page.locator('#dl-time-until').fill('11:00');
  await expect(download).toBeDisabled();
  await page.locator('#dl-time-until').fill('13:00');
  await expect(download).toBeEnabled();
  await page.locator('#dl-amount').fill('1e3');
  const url = new URL(await page.locator('#dl-api-url input').inputValue());
  expect(url.searchParams.get('max')).toBe('1000');
  expect(
    await page.evaluate(timestamp => new Date(Number(timestamp)).getHours(), url.searchParams.get('since')),
  ).toBe(12);
  expect(await page.locator('#dl-color option:checked').textContent()).toBe('All');
});

for (const width of [375, 768, 1174]) {
  test(`database and shield layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 753 });
    await page.goto('/games/database');
    await expect(page.locator('#games-database-status')).toContainText('Showing', { timeout: 30_000 });
    const wrap = page.locator('.games-database__table-wrap');
    await wrap.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await page.locator('#games-database-next').click();
    await expect(page.locator('#games-database-page')).toContainText('Page 2');
    await expect.poll(() => wrap.evaluate(el => el.scrollTop)).toBe(0);
    expect(await wrap.evaluate(el => el.clientHeight)).toBeLessThanOrEqual(753 * 0.71);
    await page.screenshot({ path: `.tools/reports2-4/database-${width}.png` });
    await page.goto('/tournament/shields');
    const shields = page.locator('.tournament-shields .shield-trophy');
    expect(await shields.count()).toBeGreaterThan(0);
    for (const shield of await shields.all()) {
      const fits = await shield.evaluate(el => {
        const box = el.getBoundingClientRect();
        const row = el.closest('h2')!.getBoundingClientRect();
        return box.top >= row.top && box.bottom <= row.bottom;
      });
      expect(fits).toBe(true);
    }
    await page.screenshot({ path: `.tools/reports2-4/shields-${width}.png`, fullPage: true });
  });
}
