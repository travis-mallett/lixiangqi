import { expect, test, type Page } from '@playwright/test';

const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const missingRook = initialFen.replace('RNBAKABNR w', 'RNBAKABN1 b');

async function analysis(page: Page) {
  await page.route('**/api/analysis/book', route =>
    route.fulfill({
      json: {
        sourceUrl: 'https://example.test/book',
        moves: [{ move: 'h8h1', notation: 'c8+7', score: 1844, note: '' }],
      },
    }),
  );
  await page.goto('/analysis');
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  await expect(page.locator('#xiangqi-fen')).toHaveValue(initialFen);
}

test('cloud scores use Red perspective and position changes clear disabled evaluations', async ({ page }) => {
  await analysis(page);
  await page.locator('#xiangqi-fen').fill(missingRook);
  await page.locator('#xiangqi-load-fen').click();
  await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-turn', 'black');
  await page.locator('#xiangqi-engine-use-cloud').check({ force: true });
  await page.locator('#xiangqi-engine-enabled').check({ force: true });
  await expect(page.locator('#xiangqi-engine-score')).toHaveText('−18.44');
  await expect(page.locator('#xiangqi-engine-lines .xiangqi-engine__score').first()).toHaveText('−18.44');
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  await page.locator('#xiangqi-reset').click();
  await expect(page.locator('#xiangqi-fen')).toHaveValue(initialFen);
  await expect(page.locator('#xiangqi-engine-score')).toHaveText('—');
  await expect(page.locator('#xiangqi-eval-score')).toHaveText('—');
  await expect(page.locator('#xiangqi-eval')).toHaveAttribute('aria-valuenow', '50.0');
  await page.locator('#xiangqi-notation').fill('1. C2=5 h8+7 2. H2+3 r9=8');
  await page.locator('#xiangqi-import-notation').click();
  await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '4');
  await expect(page.locator('#xiangqi-engine-score')).toHaveText('—');
});

test('deleting an active ancestor updates the board, tree, movetext and persisted selection', async ({
  page,
}) => {
  await analysis(page);
  await page.locator('#xiangqi-notation').fill('1. C2=5 h8+7 2. H2+3 r9=8');
  await page.locator('#xiangqi-import-notation').click();
  await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '4');
  await page.locator('.xiangqi-analysis__move').first().click({ button: 'right' });
  await page.getByRole('button', { name: 'Delete 4 moves from here', exact: true }).click();
  await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '0');
  await expect(page.locator('#xiangqi-fen')).toHaveValue(initialFen);
  await expect(page.locator('.xiangqi-analysis__move')).toHaveCount(0);
  await expect(page.locator('#xiangqi-notation')).not.toHaveValue(/C2=5/);
  await expect(page.locator('#xiangqi-status')).not.toContainText('Invalid');
  await page.reload();
  await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '0');
  await expect(page.locator('.xiangqi-analysis__move')).toHaveCount(0);
});

test('replay transport names and native Enter, Space, pointer and hold activation agree', async ({
  page,
}) => {
  await page.goto(`/${process.env.QA_REPLAY_GAME || 'nihVfvcX'}`);
  const first = page.getByRole('button', { name: 'First position', exact: true }).first();
  const next = page.getByRole('button', { name: 'Next move', exact: true }).first();
  await first.click();
  await expect(next).toHaveAttribute('data-ply', '1');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(next).toHaveAttribute('data-ply', '2');
  await page.keyboard.press('Space');
  await expect(next).toHaveAttribute('data-ply', '3');
  await next.click();
  await expect(next).toHaveAttribute('data-ply', '4');
  await next.hover();
  await page.mouse.down();
  await expect.poll(async () => Number(await next.getAttribute('data-ply'))).toBeGreaterThan(4);
  await page.mouse.up();
  const stopped = await next.getAttribute('data-ply');
  await page.waitForTimeout(650);
  await expect(next).toHaveAttribute('data-ply', stopped!);
  for (const label of ['First position', 'Previous move', 'Next move', 'Last position'])
    await expect(page.getByRole('button', { name: label, exact: true }).first()).toHaveAttribute(
      'title',
      label,
    );
});

for (const width of [390, 900, 1174]) {
  test(`homepage help and direct Custom setup remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 753 });
    await page.goto('/');
    for (const label of ['How Xiangqi ratings change', 'About Xiangqi ranks']) {
      const trigger = page.getByRole('button', { name: label, exact: true });
      await trigger.click();
      const tip = page.locator('#siteTooltip:visible, [popover]:popover-open');
      await expect(tip).toBeVisible();
      await expect(tip).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: `.tmp/qa-report6/help-${width}-${label.startsWith('About') ? 'rank' : 'rating'}.png`,
      });
      await page.mouse.move(0, 0);
      await trigger.blur();
    }
    await page.locator('.lobby__time-controls summary').click();
    await page.locator('.lobby__quick-room--lobby').click();
    await expect(page.locator('dialog')).toContainText('Game setup');
    await expect(page.locator('dialog.lobby__overlay')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
  });

  test(`fresh puzzles reveal their selected move and name controls at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 753 });
    for (const id of ['vKDT4', process.env.QA_SECOND_PUZZLE || '9H4p7']) {
      await page.goto(`/training/${id}`);
      await expect(page.locator('.puzzle__actions .hint')).toBeEnabled({ timeout: 90_000 });
      const active = page.locator('.puzzle__moves .active');
      await expect(active).toBeInViewport({ ratio: 1 });
      await expect
        .poll(() =>
          active.evaluate(el => {
            const a = el.getBoundingClientRect();
            const p = el.closest('.puzzle__moves')!.getBoundingClientRect();
            return (
              a.top >= p.top - 1 && a.bottom <= p.bottom + 1 && a.left >= p.left - 1 && a.right <= p.right + 1
            );
          }),
        )
        .toBe(true);
      await page.screenshot({ path: `.tmp/qa-report6/puzzle-${id}-${width}.png` });
      for (const label of ['First position', 'Previous move', 'Next move', 'Last position'])
        await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('title', label);
      const previous = page.getByRole('button', { name: 'Previous move', exact: true });
      await previous.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Next move', exact: true })).toBeEnabled();
    }
  });
}

test('player search finds displayed romanizations and explains empty results with a recovery link', async ({
  page,
}) => {
  for (const [query, native] of [
    ['Xu Wenzhang', '许文章'],
    ['Meng Chen', '孟辰'],
  ]) {
    await page.goto(`/players?q=${encodeURIComponent(query)}`);
    await expect(page.locator('.directory-players-table tbody')).toContainText(native);
    await expect(page.locator('input[name="q"]')).toHaveValue(query);
  }
  await page.goto('/players?q=zzzzzz');
  await expect(page.getByRole('status')).toContainText('No players found');
  await page.getByRole('link', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('input[name="q"]')).toHaveValue('');
  await expect(page.locator('.directory-players-table tbody tr').first()).toBeVisible();
});
