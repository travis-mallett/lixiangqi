import { expect, test, type Page } from '@playwright/test';

async function analysis(page: Page): Promise<void> {
  await page.goto('/analysis');
  await page.locator('#xiangqi-engine-enabled').uncheck({ force: true });
  await expect(page.locator('#xiangqi-fen')).not.toHaveValue('');
}

async function importMoves(page: Page, text = '1. C8=5 c8=5'): Promise<void> {
  await page.locator('#xiangqi-notation').fill(text);
  await page.locator('#xiangqi-import-notation').click();
  await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '2');
}

test('pending imports and their errors stay with their analysis tab', async ({ page }) => {
  await page.setViewportSize({ width: 1174, height: 753 });
  await analysis(page);
  await importMoves(page);
  const original = await page.locator('#xiangqi-notation').inputValue();
  const originalFen = await page.locator('#xiangqi-fen').inputValue();
  await page.getByRole('button', { name: 'New analysis tab', exact: true }).click();
  await expect(page.locator('.xiangqi-analysis__tab.active .xiangqi-analysis__tab-select')).toHaveText(
    'Analysis 2',
  );
  const draft = '1. C2=5 c2=5 2. H2+3 invalid';
  await page.locator('#xiangqi-notation').fill(draft);
  await page.locator('#xiangqi-import-notation').click();
  await expect(page.locator('#xiangqi-notation-error')).toContainText('invalid');
  await expect(page.locator('#xiangqi-notation-error')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '.tmp/qa-report5/import-error.png' });
  await expect(page.locator('#xiangqi-notation')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('tab', { name: 'Analysis 1', exact: true }).click();
  await expect(page.locator('#xiangqi-notation')).toHaveValue(original);
  await expect(page.locator('#xiangqi-fen')).toHaveValue(originalFen);
  await expect(page.locator('#xiangqi-notation-error')).toBeHidden();
  await page.locator('#xiangqi-previous').click();
  await expect(page.locator('#xiangqi-notation')).toHaveValue(original);
  await page.getByRole('tab', { name: 'Analysis 2', exact: true }).click();
  await expect(page.locator('#xiangqi-notation')).toHaveValue(draft);
  await expect(page.locator('#xiangqi-notation-error')).toContainText('invalid');
  await page.locator('#xiangqi-notation').fill('1. C2=5 c2=5');
  await page.locator('#xiangqi-fen').fill('pending-fen');
  await page.getByRole('button', { name: 'New analysis tab', exact: true }).click();
  await expect(page.locator('.xiangqi-analysis__tab.active .xiangqi-analysis__tab-select')).toHaveText(
    'Analysis 3',
  );
  await expect(page.locator('#xiangqi-notation')).not.toHaveValue('1. C2=5 c2=5');
  await expect(page.locator('#xiangqi-fen')).not.toHaveValue('pending-fen');
  await page.getByRole('tab', { name: 'Analysis 2', exact: true }).click();
  await expect(page.locator('#xiangqi-fen')).toHaveValue('pending-fen');
  await expect(page.locator('#xiangqi-notation')).toHaveValue('1. C2=5 c2=5');
  await page.getByRole('button', { name: 'Close Analysis 2', exact: true }).click();
  await expect(page.locator('#xiangqi-notation')).toHaveValue(original);
  await expect(page.locator('#xiangqi-fen')).not.toHaveValue('pending-fen');
});

test('settings contain keyboard focus and isolate replay while preserving radio keyboard input', async ({
  page,
}) => {
  await analysis(page);
  await importMoves(page);
  const fen = await page.locator('#xiangqi-fen').inputValue();
  const gear = page.locator('#xiangqi-interface-settings-button');
  for (let i = 0; i < 2; i++) {
    await gear.click();
    await expect(page.locator('#xiangqi-interface-settings-close')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    await page.locator('#xiangqi-interface-settings-close').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#xiangqi-fen')).toHaveValue(fen);
    await page.locator('#xiangqi-notation-layout-two-column').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#xiangqi-notation-layout-compact')).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#xiangqi-notation-layout-two-column')).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(gear).toBeFocused();
  }
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '1');
});

test('blindfold conceals both piece faces and live shadow layers', async ({ page }) => {
  await analysis(page);
  await importMoves(page);
  await page.evaluate(async () => {
    await (window as any).site.asset.loadCssPath('puzzle');
    document.querySelector('.main-board')!.classList.add('blindfold');
  });
  await expect(page.locator('#xiangqi-board .xiangqi-shadow-layer')).toHaveCSS('opacity', '0');
  await expect(page.locator('#xiangqi-board piece').first()).toHaveCSS('opacity', '0');
  await page.locator('#xiangqi-previous').click();
  await expect(page.locator('#xiangqi-board .xiangqi-shadow-layer')).toHaveCSS('opacity', '0');
  await page.evaluate(() => document.querySelector('.main-board')!.classList.remove('blindfold'));
  await expect(page.locator('#xiangqi-board .xiangqi-shadow-layer')).toHaveCSS('opacity', '1');
  await expect(page.locator('#xiangqi-board piece').first()).toHaveCSS('opacity', '1');
});

const player = { name: 'QA Red' };
const game = {
  id: 'qa-game',
  sources: [],
  red: player,
  black: { name: 'QA Black' },
  result: 1,
  moves: 10,
  playedAt: '1979-02',
};
const counts = { m: 1 };

async function mockCatalog(
  page: Page,
  kind: 'event' | 'player',
): Promise<Array<{ sources: string[]; color: string }>> {
  const requests: Array<{ sources: string[]; color: string }> = [];
  await page.route('**/explorer', async route => {
    const query = route.request().postDataJSON();
    requests.push(query);
    await route.fulfill({
      json: {
        available: true,
        red: query.sources?.includes('m') ? 1 : 0,
        draws: 0,
        black: 0,
        moves: [],
        topGames: [],
        recentGames: [],
      },
    });
  });
  await page.route(`**/games/${kind}`, async route => {
    const count = route.request().postDataJSON().sources.includes('m') ? 1 : 0;
    const common = {
      totalGames: count,
      firstPlayedAt: count ? '1979-02-00' : null,
      lastPlayedAt: count ? '1979-02-00' : null,
      averageMoves: count ? 10 : null,
      topOpenings: count ? [{ name: 'Cannon', games: 1 }] : [],
    };
    if (kind === 'event') {
      await route.fulfill({
        json: {
          available: true,
          event: { name: 'QA Event', query: 'QA Event' },
          sourceCounts: counts,
          summary: {
            ...common,
            players: count * 2,
            rounds: count,
            recordedOpenings: count,
            redWins: count,
            draws: 0,
            blackWins: 0,
            places: [],
            standings: count
              ? [{ ...player, rank: 1, games: 1, wins: 1, draws: 0, losses: 0, score: 2 }]
              : [],
          },
          rounds: count ? [{ name: '', dates: ['1979-02-00'], games: [game] }] : [],
        },
      });
    } else {
      const outcome = { games: count, wins: count, draws: 0, losses: 0 };
      await route.fulfill({
        json: {
          available: true,
          player: { name: 'QA Red', query: 'QA Red', nativeName: 'QA Red', key: 'qared' },
          sourceCounts: counts,
          summary: {
            ...common,
            firstPlayedAt: count ? '1978-00-00' : null,
            opponents: count,
            events: count,
            averageRating: null,
            overall: outcome,
            red: outcome,
            black: { games: 0, wins: 0, draws: 0, losses: 0 },
            topOpponents: [],
          },
          total: count,
          page: 1,
          pageSize: 100,
          games: count ? [game] : [],
          timeline: { unit: 'year', buckets: count ? [{ start: '1978', count }] : [], undated: 0 },
        },
      });
    }
  });
  return requests;
}

for (const kind of ['event', 'player'] as const) {
  test(`${kind} summary and explorer share source filters, including no matching games and reload`, async ({
    page,
  }) => {
    const requests = await mockCatalog(page, kind);
    await page.goto(`/games/database/${kind}?${kind}=${kind === 'event' ? 'QA+Event' : 'QA+Red'}`);
    await expect(page.locator(`#${kind}-database-status`)).toContainText('statistics loaded');
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect(page.locator(`#${kind}-database-range`)).toContainText(
      kind === 'event' ? 'February 1979' : '1978',
    );
    if (kind === 'event') await expect(page.locator('#event-round-list')).toContainText('February 1979');
    await page.locator(`label[for="${kind}-source-m"]`).click();
    await expect(page.locator(`#${kind}-database-range`)).toContainText('No games match');
    await expect(page.locator(`#${kind}-metric-games`)).toHaveText('0');
    await expect(page.locator(`#${kind}-metric-moves`)).toHaveText('—');
    await expect(page.locator(`#${kind}-database-status`)).not.toHaveClass(/error/);
    await expect.poll(() => requests.at(-1)?.sources.includes('m')).toBe(false);
    if (kind === 'event') {
      await expect(page.locator('#event-metric-openings')).toHaveText('0');
      await expect(page.locator('#event-round-list')).toBeEmpty();
      await expect(page.locator('#event-standings-rows')).toContainText('No standings');
    } else {
      await page.locator('#player-side-black').click();
      await expect.poll(() => requests.at(-1)?.color).toBe('black');
      expect(requests.at(-1)?.sources).not.toContain('m');
    }
    await page.reload();
    await expect(page.locator(`[data-${kind}-sources="m"]`)).not.toBeChecked();
    await expect(page.locator(`#${kind}-database-range`)).toContainText('No games match');
    await page.locator(`label[for="${kind}-source-m"]`).click();
    await expect(page.locator(`#${kind}-metric-games`)).toHaveText('1');
    await expect.poll(() => requests.at(-1)?.sources.includes('m')).toBe(true);
  });
}

for (const width of [390, 900, 1280]) {
  test(`calendar dates, settings and opening guidance remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tournament/calendar');
    const dates = page.locator('#tournament-calendar date');
    await expect(dates.first()).toBeInViewport();
    await dates.nth(15).scrollIntoViewIfNeeded();
    await expect(dates.nth(15)).toBeInViewport();
    await page.locator('#tournament-calendar').evaluate(el => {
      el.scrollLeft = 250;
    });
    await expect(dates.nth(15)).toBeInViewport();
    await page.locator('#tournament-calendar').evaluate(el => {
      el.scrollLeft = 0;
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `.tmp/qa-report5/calendar-${width}.png` });
    await page.route('**/api/analysis/book', route =>
      route.fulfill({ json: { sourceUrl: 'https://www.chessdb.cn', metric: 'dtm', moves: [] } }),
    );
    await analysis(page);
    await page.getByRole('button', { name: 'Opening book', exact: true }).click();
    await expect(page.locator('.explorer-box')).not.toHaveClass(/loading/);
    const note = page.locator('.explorer-box .explanation');
    await expect(note).toBeVisible();
    expect(await note.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.tmp/qa-report5/book-${width}.png` });
    await page.locator('#xiangqi-interface-settings-button').click();
    await expect(page.locator('#xiangqi-interface-settings-close')).toBeInViewport();
    expect(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `.tmp/qa-report5/settings-${width}.png` });
    await page.keyboard.press('Escape');
  });
}
