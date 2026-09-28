import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 432, height: 900 } });

const openAnalysis = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/analysis');
  await expect(page.locator('.xiangqi-analysis-board')).toBeVisible();
};

const engineRows = (page: Page) => page.locator('#xiangqi-engine-lines > .pv');

const expectEngineLines = async (page: Page, count: number) => {
  await expect(engineRows(page)).toHaveCount(count);
  await expect(page.locator('#xiangqi-engine-multipv')).toHaveValue(String(count));
};

const setRangeValue = async (page: Page, selector: string, value: number, min: number) => {
  const input = page.locator(selector);
  await input.focus();
  await input.press('Home');
  for (let current = min; current < value; current++) await input.press('ArrowRight');
  await input.dispatchEvent('change');
};

const setMultiPv = async (page: Page, count: number) => {
  await page.locator('#xiangqi-engine-settings-button').click();
  await setRangeValue(page, '#xiangqi-engine-multipv', count, 1);
  await expectEngineLines(page, count);
};

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

test('uses one engine line on fresh mobile analysis', async ({ page }) => {
  await openAnalysis(page, 390);
  await expectEngineLines(page, 1);
});

test('uses three engine lines on fresh desktop analysis', async ({ page }) => {
  await openAnalysis(page, 1280);
  await expectEngineLines(page, 3);
});

test('updates the default line count when crossing the mobile breakpoint', async ({ page }) => {
  await openAnalysis(page, 799);
  await expectEngineLines(page, 1);

  await page.setViewportSize({ width: 800, height: 900 });
  await expectEngineLines(page, 3);

  await page.setViewportSize({ width: 799, height: 900 });
  await expectEngineLines(page, 1);
});

test('keeps the default line count after an unrelated setting change and reload', async ({ page }) => {
  await openAnalysis(page, 800);
  await expectEngineLines(page, 3);

  await page.locator('#xiangqi-engine-settings-button').click();
  await setRangeValue(page, '#xiangqi-engine-depth', 21, 10);
  await page.reload();
  await expectEngineLines(page, 3);
  await page.setViewportSize({ width: 799, height: 900 });
  await expectEngineLines(page, 1);
  await page.setViewportSize({ width: 800, height: 900 });
  await expectEngineLines(page, 3);
});

test('keeps an explicit mobile preference across desktop, mobile, and reload', async ({ page }) => {
  await openAnalysis(page, 390);
  await setMultiPv(page, 3);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expectEngineLines(page, 3);
  await page.setViewportSize({ width: 390, height: 900 });
  await expectEngineLines(page, 3);
  await page.reload();
  await expectEngineLines(page, 3);
});

test('keeps an explicit desktop preference across mobile and desktop', async ({ page }) => {
  await openAnalysis(page, 1280);
  await setMultiPv(page, 1);

  await page.setViewportSize({ width: 390, height: 900 });
  await expectEngineLines(page, 1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectEngineLines(page, 1);
});

test('collapses disabled engine rows on mobile and restores them when enabled', async ({ page }) => {
  await openAnalysis(page, 390);
  await expectEngineLines(page, 1);

  const engine = page.locator('.xiangqi-engine');
  const engineLines = page.locator('#xiangqi-engine-lines');
  const enabled = page.locator('#xiangqi-engine-enabled');
  const switchLabel = page.locator('.xiangqi-engine__switch');
  await switchLabel.click();
  await expect(enabled).not.toBeChecked();
  await expect(engineLines).toBeHidden();
  await expect(page.locator('#xiangqi-more-lines')).toBeHidden();
  await expect(switchLabel).toBeVisible();
  await expect(page.locator('#xiangqi-engine-settings-button')).toBeVisible();

  await switchLabel.click();
  await expect(enabled).toBeChecked();
  await expect(engineLines).toBeVisible();
  await expect(engineRows(page)).toHaveCount(1);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expectEngineLines(page, 3);
  await switchLabel.click();
  await expect(enabled).not.toBeChecked();
  await expect(engineLines).toBeVisible();
  await expect(engine).toBeVisible();
});
