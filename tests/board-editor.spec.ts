import { expect, test, type Page } from '@playwright/test';

const startFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const emptyFen = '9/9/9/9/9/9/9/9/9/9 w - - 0 1';
const playable = (page: Page) =>
  expect(page.locator('.board-editor__status')).toHaveText('Valid position with legal moves');

async function square(page: Page, file: number, rank: number) {
  const bounds = (await page.locator('.board-editor .cg-wrap').boundingBox())!;
  return {
    x: bounds.x + ((58 + file * 98) / 900) * bounds.width,
    y: bounds.y + ((59 + (10 - rank) * 98) / 1000) * bounds.height,
  };
}

for (const width of [1440, 900, 390]) {
  test(`editor fits ${width}px and shows both complete spare armies`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto('/editor');
    await playable(page);
    await expect(page.locator('.spare .white')).toHaveCount(7);
    await expect(page.locator('.spare .black')).toHaveCount(7);
    expect(
      await page
        .locator('.spare .white')
        .first()
        .evaluate(el => window.getComputedStyle(el).backgroundImage),
    ).not.toBe('none');
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      board: document.querySelector('.board-editor .cg-wrap')!.getBoundingClientRect().toJSON(),
    }));
    expect(layout.scroll).toBe(layout.width);
    expect(layout.board.width / layout.board.height).toBeCloseTo(0.9, 2);
    expect(layout.board.width).toBeGreaterThan(270);
  });
}

test('query and shared links retain the FEN, counters, turn and black perspective', async ({ page }) => {
  const fen = startFen.replace('w - - 0 1', 'b - - 17 42');
  await page.goto(`/editor?${new URLSearchParams({ fen, color: 'black' })}`);
  await playable(page);
  await expect(page.locator('#editor-fen')).toHaveValue(fen);
  await expect(page.getByLabel('Side to move')).toHaveValue('black');
  await expect(page.locator('.spare-black')).toHaveClass(/spare-bottom/);
  const url = await page.locator('#editor-url').inputValue();
  await page.goto(url);
  await playable(page);
  await expect(page.locator('#editor-fen')).toHaveValue(fen);
  await expect(page.locator('.spare-black')).toHaveClass(/spare-bottom/);
  await page.getByRole('button', { name: 'Starting position', exact: true }).click();
  await expect(page.getByLabel('Side to move')).toHaveValue('red');
});

test('places, replaces, erases and drags pieces without starting unintended moves', async ({ page }) => {
  await page.goto('/editor');
  await playable(page);
  await page.getByRole('button', { name: 'Clear board', exact: true }).click();
  await expect(page.locator('#editor-fen')).toHaveValue(emptyFen);
  await expect(page.locator('.board-editor .actions a[href]')).toHaveCount(0);
  const a10 = await square(page, 0, 10);
  const a9 = await square(page, 0, 9);
  await page.locator('[data-selection="red:chariot"]').click();
  await page.mouse.click(a10.x, a10.y);
  await expect(page.locator('#editor-fen')).toHaveValue('R8/9/9/9/9/9/9/9/9/9 w - - 0 1');
  await page.locator('[data-selection="black:cannon"]').click();
  await page.mouse.click(a10.x, a10.y);
  await expect(page.locator('#editor-fen')).toHaveValue('c8/9/9/9/9/9/9/9/9/9 w - - 0 1');
  await page.locator('.spare-top [data-selection="pointer"]').click();
  await page.mouse.move(a10.x, a10.y);
  await page.mouse.down();
  await page.mouse.move(a9.x, a9.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('#editor-fen')).toHaveValue('9/c8/9/9/9/9/9/9/9/9 w - - 0 1');
  await page.locator('.spare-top [data-selection="trash"]').click();
  await page.mouse.click(a9.x, a9.y);
  await expect(page.locator('#editor-fen')).toHaveValue(emptyFen);
});

test('strict validation rejects missing generals, facing generals and other variants', async ({ page }) => {
  await page.goto('/editor');
  await playable(page);
  const input = page.locator('#editor-fen');
  for (const fen of [emptyFen, '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1']) {
    await input.fill(fen);
    await input.press('Enter');
    await expect(page.locator('.board-editor__status')).toContainText('Invalid position.');
    await expect(page.locator('.board-editor .actions a[href]')).toHaveCount(0);
  }
  await input.fill(startFen.replace(' - - ', ' j - '));
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#editor-fen-error')).toBeVisible();
});

test('standard analysis opens the selected position in the editor', async ({ page }) => {
  await page.goto('/analysis');
  await page.waitForFunction(() => 'lixiangqiGround' in window);
  await page.locator('#xiangqi-interface-settings-button').click();
  await expect(page.locator('#xiangqi-edit-position')).toHaveText('Board editor');
  await page.locator('#xiangqi-edit-position').click();
  await expect(page).toHaveURL(/\/editor\?/);
  await playable(page);
  await expect(page.locator('#editor-fen')).toHaveValue(startFen);
});

test('copies FEN and opens computer/friend setup with the edited position', async ({ page, context }) => {
  const fen = startFen.replace('0 1', '17 42');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const label of ['Play against computer', 'Challenge a friend']) {
    await page.goto(`/editor?${new URLSearchParams({ fen })}`);
    await playable(page);
    await page
      .locator('.copyables p')
      .filter({ has: page.locator('#editor-fen') })
      .getByRole('button')
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fen);
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page.locator('#fen-input')).toHaveValue(fen);
  }
});

test('strict API validates the effective imported position while preserving diagram replay', async ({
  request,
}) => {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const permissive = await request.post('/api/analysis/position', {
    headers,
    data: { initialFen: emptyFen, moves: [] },
  });
  expect(permissive.ok()).toBeTruthy();
  const strict = await request.post('/api/analysis/position?strict=true', {
    headers,
    data: { initialFen: emptyFen, moves: [] },
  });
  expect(strict.status()).toBe(400);
  const invalidImport = await request.post('/api/analysis/import?strict=true', {
    headers,
    data: { notation: `[FEN "${emptyFen}"]\n\n*`, initialFen: startFen },
  });
  expect(invalidImport.status()).toBe(400);
  const validImport = await request.post('/api/analysis/import?strict=true', {
    headers,
    data: { notation: '*', initialFen: startFen },
  });
  expect(validImport.ok()).toBeTruthy();
});

test.describe('touch editor', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 950 } });

  test('tap selection places and erases pieces on a phone', async ({ page }) => {
    await page.goto('/editor');
    await playable(page);
    await page.getByRole('button', { name: 'Clear board', exact: true }).tap();
    await page.locator('[data-selection="black:general"]').tap();
    const e10 = await square(page, 4, 10);
    await page.touchscreen.tap(e10.x, e10.y);
    await expect(page.locator('#editor-fen')).toHaveValue('4k4/9/9/9/9/9/9/9/9/9 w - - 0 1');
    await page.locator('.spare-top [data-selection="trash"]').tap();
    await page.touchscreen.tap(e10.x, e10.y);
    await expect(page.locator('#editor-fen')).toHaveValue(emptyFen);
  });
});

const variants = [
  {
    key: 'jieqi',
    fen: 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w j - 0 1',
    red: 8,
    black: 8,
    ratio: 0.9,
  },
  { key: 'minixiangqi', fen: 'rcnkncr/p1ppp1p/7/7/7/P1PPP1P/RCNKNCR w - - 0 1', red: 5, black: 5, ratio: 1 },
  {
    key: 'manchu',
    fen: 'm1bakab1r/9/9/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w m - 0 1',
    red: 7,
    black: 6,
    ratio: 0.9,
  },
  { key: 'threeKingdoms', red: 7, black: 7 },
];

for (const variant of variants)
  for (const width of [1440, 900, 390]) {
    test(`${variant.key} editor fits ${width}px with native pieces, geometry and share links`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/editor?variant=${variant.key}`);
      await playable(page);
      await expect(page.locator('#editor-variant')).toHaveValue(variant.key);
      await expect(page.locator('.spare-red [data-army]')).toHaveCount(variant.red);
      await expect(page.locator('.spare-black [data-army]')).toHaveCount(variant.black);
      if (variant.key === 'threeKingdoms')
        await expect(page.locator('.spare-green [data-army]')).toHaveCount(7);
      if (variant.fen) await expect(page.locator('#editor-fen')).toHaveValue(variant.fen);
      const layout = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        board: document.querySelector('.board-editor .cg-wrap')!.getBoundingClientRect().toJSON(),
      }));
      expect(layout.scroll).toBe(layout.width);
      if (variant.ratio) expect(layout.board.width / layout.board.height).toBeCloseTo(variant.ratio, 2);
      for (const palette of await page.locator('.spare [data-army] piece').all())
        expect(await palette.evaluate(el => window.getComputedStyle(el).backgroundImage)).not.toBe('none');
      const fen = await page.locator('#editor-fen').inputValue();
      await page.getByRole('button', { name: 'Flip board', exact: true }).click();
      await page.goto(await page.locator('#editor-url').inputValue());
      await playable(page);
      await expect(page.locator('#editor-fen')).toHaveValue(fen);
      await expect(page.locator('#editor-variant')).toHaveValue(variant.key);
    });
  }

for (const variant of variants.filter(v => v.key !== 'threeKingdoms')) {
  test(`${variant.key} analysis and editor preserve the selected position`, async ({ page }) => {
    await page.goto(`/analysis/${variant.key}`);
    await page.waitForFunction(() => 'lixiangqiGround' in window);
    await page.locator('#xiangqi-interface-settings-button').click();
    await page.locator('#xiangqi-edit-position').click();
    await playable(page);
    await expect(page.locator('#editor-variant')).toHaveValue(variant.key);
    await expect(page.locator('#editor-fen')).toHaveValue(variant.fen!);
    await page.locator('.actions').getByRole('link', { name: 'Analysis board', exact: true }).click();
    await expect(page.locator('#xiangqi-fen')).toHaveValue(variant.fen!);
  });
}

test('Jieqi and Three Kingdoms explain why edited positions cannot start a game', async ({ page }) => {
  for (const variant of ['jieqi', 'threeKingdoms']) {
    await page.goto(`/editor?variant=${variant}`);
    await playable(page);
    await expect(page.locator('.actions a[href]')).toHaveCount(1);
    await expect(page.locator('.actions .board-editor__help')).toContainText('can be analysed');
  }
});

test('Three Kingdoms supports editing and army transfers without losing the diagram on reload', async ({
  page,
}) => {
  await page.goto('/editor?variant=threeKingdoms');
  await playable(page);
  const generalSquare = page.locator('.graph-board__location[data-location="shu:4:0"]');
  const clickGeneralSquare = async () => {
    await generalSquare.scrollIntoViewIfNeeded();
    const rect = (await generalSquare.boundingBox())!;
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  };
  await page.locator('.spare-red [data-selection="trash"]').click();
  await clickGeneralSquare();
  await expect(page.locator('.board-editor__status')).toContainText('Invalid position');
  await page.locator('[data-selection="red:general"]').click();
  await clickGeneralSquare();
  await playable(page);
  await page
    .locator('.board-editor__owners')
    .getByRole('combobox', { name: 'Wu — green', exact: true })
    .selectOption('red');
  await playable(page);
  const fen = await page.locator('#editor-fen').inputValue();
  await page.goto(await page.locator('#editor-url').inputValue());
  await playable(page);
  await expect(page.locator('#editor-fen')).toHaveValue(fen);
  await expect(
    page.locator('.board-editor__owners').getByRole('combobox', { name: 'Wu — green', exact: true }),
  ).toHaveValue('red');
  await page.locator('.actions').getByRole('link', { name: 'Analysis board', exact: true }).click();
  await expect(page.locator('#xiangqi-fen')).toHaveValue(fen);
  await page.locator('#xiangqi-interface-settings-button').click();
  await page.locator('#xiangqi-edit-position').click();
  await playable(page);
  await expect(page.locator('#editor-fen')).toHaveValue(fen);
});

test('Mini Xiangqi and Manchu custom setups retain their FEN and variant difficulty', async ({ page }) => {
  for (const variant of variants.filter(v => ['minixiangqi', 'manchu'].includes(v.key))) {
    for (const label of ['Play against computer', 'Challenge a friend']) {
      await page.goto(`/editor?variant=${variant.key}`);
      await playable(page);
      await page.getByRole('link', { name: label, exact: true }).click();
      await expect(page.locator('#fen-input')).toHaveValue(variant.fen!);
      await expect(page.locator('#sf_ruleset')).toHaveCount(0);
    }
  }
});

test('variant validation stays separate from the Standard-only mobile strict API', async ({ request }) => {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  for (const variant of variants.filter(v => v.fen)) {
    const result = await request.post(`/editor/validate?variant=${variant.key}`, {
      headers,
      data: { fen: variant.fen },
    });
    expect(result.ok()).toBeTruthy();
    expect((await result.json()).playable).toBeTruthy();
    const mobile = await request.post('/api/analysis/position?strict=true', {
      headers,
      data: { initialFen: variant.fen, moves: [] },
    });
    expect(mobile.status()).toBe(400);
  }
});

test('Mini Xiangqi uses its own edge intersections when placing pieces', async ({ page }) => {
  await page.goto('/editor?variant=minixiangqi');
  await playable(page);
  await page.getByRole('button', { name: 'Clear board', exact: true }).click();
  await page.locator('[data-selection="black:chariot"]').click();
  const board = (await page.locator('.board-editor .cg-wrap').boundingBox())!;
  await page.mouse.click(board.x + (644 / 700) * board.width, board.y + (56 / 700) * board.height);
  await expect(page.locator('#editor-fen')).toHaveValue('6r/7/7/7/7/7/7 w - - 0 1');
});

test('Jieqi concealed pieces can be replaced in their native starting slots', async ({ page }) => {
  await page.goto('/editor?variant=jieqi');
  await playable(page);
  const a10 = await square(page, 0, 10);
  await page.locator('.spare-black [data-selection="trash"]').click();
  await page.mouse.click(a10.x, a10.y);
  await expect(page.locator('#editor-fen')).toHaveValue(/^1xxxkxxxx\//);
  await page.locator('[data-selection="black:concealed"]').click();
  await page.mouse.click(a10.x, a10.y);
  await playable(page);
  await expect(page.locator('#editor-fen')).toHaveValue(variants[0].fen!);
});

test.describe('Three Kingdoms touch editor', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 950 } });

  test('tap selection restores a general on the graph board', async ({ page }) => {
    await page.goto('/editor?variant=threeKingdoms');
    await playable(page);
    const fields = (await page.locator('#editor-fen').inputValue()).split(';');
    fields[10] = ''; // Editing clears repetition history while preserving the diagram.
    const general = page.locator('[data-piece-location="shu:4:0"]');
    const rect = (await general.boundingBox())!;
    await page.locator('.spare-red [data-selection="trash"]').tap();
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await expect(page.locator('.board-editor__status')).toContainText('Invalid position');
    await page.locator('[data-selection="red:general"]').tap();
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await playable(page);
    await expect(page.locator('#editor-fen')).toHaveValue(fields.join(';'));
  });
});
