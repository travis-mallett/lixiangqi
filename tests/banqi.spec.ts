import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

test('Banqi analysis loads the on-device engine and finishes a public search', async ({ page }) => {
  await page.goto('/analysis/banqi');
  await expect(page.locator('.xiangqi-engine__name')).toContainText('BanqiFish');
  const enabled = page.locator('#xiangqi-engine-enabled');
  if (!(await enabled.isChecked())) await enabled.evaluate(input => (input as HTMLInputElement).click());
  await expect(page.locator('#xiangqi-engine-status')).toContainText('Search complete');
  await expect(page.locator('#xiangqi-engine-lines')).toContainText(/flip/i);
});

test('a black opening assigns seats and updates the next reveal probabilities', async ({ page }) => {
  await page.goto('/analysis/banqi');
  const board = page.locator('#xiangqi-board.board-assets-ready');
  await board.focus();
  await page.keyboard.press('Enter');
  const choices = page.getByRole('dialog');
  await expect(choices.getByRole('button', { name: 'Black Horse (2/32)' })).toBeVisible();
  await choices.getByRole('button', { name: 'Black Horse (2/32)' }).click();
  await expect(board).toHaveAttribute('data-turn', 'black');
  await board.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(choices.getByRole('button', { name: 'Black Horse (1/31)' })).toBeVisible();
  await expect(choices.getByRole('button', { name: 'Red Soldier (5/31)' })).toBeVisible();
});

for (const reversed of [false, true]) {
  test(
    reversed ? 'the reversed board respects reduced motion' : 'a capture makes one flight to its rail',
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: reversed ? 'reduce' : 'no-preference' });
      const fen = '4/4/4/4/4/1p2/k3/P2K w banqi r 0 1 -';
      await page.goto('/analysis?' + new URLSearchParams({ fen, color: reversed ? 'black' : 'red' }));
      const board = page.locator('#xiangqi-board.board-assets-ready cg-board');
      const victim = page.locator('[data-victim="k"]');
      await expect(victim).toHaveAttribute('aria-label', 'Black General captured, 0 of 1');
      const flights = await page.evaluateHandle(() => {
        const durations: number[] = [];
        new MutationObserver(records => {
          for (const record of records)
            for (const node of record.addedNodes) {
              if (node instanceof Element && node.classList.contains('banqi-capture-flight'))
                durations.push(Number(node.getAnimations()[0]?.effect?.getTiming().duration));
            }
        }).observe(document.body, { childList: true });
        return durations;
      });
      const bounds = (await board.boundingBox())!;
      const x = bounds.x + ((reversed ? 3.5 : 0.5) * bounds.width) / 4;
      for (const rank of [1, 2])
        await page.touchscreen.tap(x, bounds.y + ((reversed ? rank - 0.5 : 8.5 - rank) * bounds.height) / 8);
      await expect(victim).toHaveAttribute('aria-label', 'Black General captured, 1 of 1');
      await expect(board.locator('piece.black.k-piece')).toHaveCount(0);
      expect(await flights.jsonValue()).toEqual(reversed ? [] : [445]);
    },
  );
}
