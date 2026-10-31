import { expect, test } from '@playwright/test';

test('rejected imports stay editable across background redraws', async ({ page }) => {
  await page.goto('/analysis');
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  const fen = page.locator('#xiangqi-fen');
  const notation = page.locator('#xiangqi-notation');
  await expect(fen).not.toHaveValue('');
  await notation.fill('1. nonsense');
  await page.locator('#xiangqi-import-notation').click();
  await expect(notation).toHaveValue('1. nonsense');
  await expect(page.locator('#xiangqi-status')).toContainText('nonsense');
  await fen.fill('not-a-fen');
  await page.locator('#xiangqi-load-fen').click();
  await expect(page.locator('#xiangqi-status')).toContainText('FEN');
  await expect(fen).toHaveValue('not-a-fen');
  await expect(notation).toHaveValue('1. nonsense');
});

test('Jieqi reload retains mixed tabs, reveal and selected move', async ({ page }) => {
  await page.goto('/analysis');
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  await page.locator('.xiangqi-analysis-variant select').selectOption('jieqi');
  const notation = page.locator('#xiangqi-notation');
  await notation.fill('1. P9+1~chariot');
  await page.locator('#xiangqi-import-notation').click();
  await expect(page.locator('#xiangqi-status')).toContainText('Black to move');
  const saved = await page.evaluate(() => localStorage.getItem('lixiangqi.analysis.tabs.v2'));
  await page.reload();
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  await expect(page.locator('.xiangqi-analysis__tab')).toHaveCount(2);
  await expect(page.locator('#xiangqi-status')).toContainText('Black to move');
  await expect(notation).toHaveValue(/P9\+1/);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('lixiangqi.analysis.tabs.v2')!));
  expect(restored.activeId).toBe(JSON.parse(saved!).activeId);
  expect(restored.tabs.map((t: any) => t.id)).toEqual(JSON.parse(saved!).tabs.map((t: any) => t.id));
});

for (const width of [375, 768, 1280]) {
  test(`remembered correspondence is visible before Start at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem(
        'lobby.setup.anon.ai',
        JSON.stringify({
          variant: 'standard',
          fen: '',
          timeMode: 'correspondence',
          time: 5,
          increment: 3,
          days: 2,
          color: 'white',
          aiLevel: 1,
          aiTimeControls: true,
        }),
      ),
    );
    await page.goto('/?variant=jieqi#ai');
    await expect(page.locator('.footer p')).toContainText('2 days');
    await expect(page.locator('.footer p')).toBeVisible();
    await expect(page.locator('.lobby__start__button--ai')).toBeInViewport();
    await page.screenshot({ path: `.tools/report1-setup-${width}.png`, fullPage: true });
  });
}

test('unknown puzzle player has feedback and a labelled editable query', async ({ page }) => {
  await page.goto('/training/of-player?name=anonymous-qa-no-such-player');
  await expect(page.getByRole('status')).toContainText('anonymous-qa-no-such-player');
  await expect(page.getByRole('textbox', { name: /username/i })).toHaveAccessibleName(/username/i);
  await expect(page.getByRole('textbox', { name: /username/i })).toHaveValue('anonymous-qa-no-such-player');
});

for (const [id, moves] of [
  ['rgupS', ['e8e7']],
  ['hiyKA', ['a4a5']],
  ['zw7s5', ['c4c10', 'b5b9']],
] as const) {
  test(`Solution recovers the failed puzzle ${id}`, async ({ page }) => {
    test.setTimeout(120_000);
    const response = await page.goto(`/training/${id}`);
    test.skip(response?.status() === 404, `Puzzle ${id} is absent from this database snapshot`);
    await expect(page.locator('.puzzle__actions .hint')).toBeEnabled({ timeout: 90_000 });
    for (const move of moves) {
      await expect
        .poll(
          async () =>
            ((await page.locator('.puzzle__actions .hint').isVisible()) &&
              (await page.locator('.puzzle__actions .hint').isEnabled())) ||
            (await page.locator('.puzzle__actions .solution').isEnabled()),
          { timeout: 60_000 },
        )
        .toBe(true);
      if (await page.locator('.puzzle__actions .solution').isEnabled()) break;
      const played = page.locator('.puzzle__moves .xiangqi-analysis__move');
      const before = await played.count();
      await page.evaluate(uci => (window as any).lichess.puzzle.playUci(uci), move);
      await expect.poll(() => played.count()).toBeGreaterThan(before);
    }
    const solution = page.locator('.puzzle__actions .solution');
    await expect(solution).toBeEnabled({ timeout: 60_000 });
    await solution.click();
    await expect(solution).toBeEnabled({ timeout: 20_000 });
    await expect(page.locator('.puzzle__feedback')).toContainText('Puzzle complete');
    await expect(page.locator('.puzzle__moves .xiangqi-analysis__move').first()).toBeVisible();
    if (id === 'zw7s5')
      await expect(page.locator('.puzzle__moves .xiangqi-analysis__move').first()).toHaveAttribute(
        'title',
        /c4c8/,
      );
    await expect(page.locator('.puzzle__actions .restart')).toBeEnabled();
    await expect(page.locator('.puzzle__actions .next')).toBeEnabled();
    await page.locator('.puzzle__actions .restart').click();
    await expect(page.locator('.puzzle__feedback')).toContainText('Your turn');
  });
}
