import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 432, height: 900 } });

test('keeps the Xiangqi board and evaluation bar inside the mobile viewport', async ({ page }) => {
  await page.goto('/analysis');
  await expect(page.locator('.xiangqi-analysis-board')).toBeVisible();

  const expectBoardToFit = async () => {
    const layout = await page.evaluate(() => {
      const board = document.querySelector('.xiangqi-analysis-board')!.getBoundingClientRect();
      return {
        boardLeft: board.left,
        boardRight: board.right,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.boardLeft).toBeGreaterThanOrEqual(-0.5);
    expect(layout.boardRight).toBeLessThanOrEqual(layout.clientWidth + 0.5);
  };

  await expectBoardToFit();
  await page.setViewportSize({ width: 432, height: 760 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectBoardToFit();
});
