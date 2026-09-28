import { expect, test, type Page, type Route } from '@playwright/test';

import {
  createMoveTreeFromUciMainline,
  getNodeList,
  mainlineEndPath,
  serializeMoveTree,
  analysisStorageKey,
} from '../ui/xiangqi/src/tree';

const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const moves = ['a4a5', 'a7a6', 'c4c5', 'c7c6'];
const tree = createMoveTreeFromUciMainline(fen, moves);
const states = getNodeList(tree, mainlineEndPath(tree)).map(node => ({
  ...node.state,
  needsHydration: false,
}));
const analysis = {
  id: 'chart001',
  depth: 20,
  infos: [
    { ply: 1, cp: 0, variation: [] },
    { ply: 2, cp: -130, variation: [] },
    { ply: 3, cp: 280, variation: [] },
    { ply: 4, mate: 0, variation: [] },
  ],
};

async function fetchFixture(route: Route) {
  // Browsers resolve *.localhost, but Node's resolver does not on Windows.
  const url = new URL(route.request().url());
  const host = url.host;
  if (url.hostname.endsWith('.localhost')) url.hostname = '127.0.0.1';
  return route.fetch({ url: url.href, headers: { ...route.request().headers(), host } });
}

async function nativeFixture(page: Page, analysed = true) {
  await page.route('**/analysis', async route => {
    const response = await fetchFixture(route);
    const html = await response.text();
    const body = html
      .replace(
        /(<script type="application\/json" id="page-init-data">)([\s\S]*?)(<\/script>)/,
        (_match, before, json, after) =>
          before +
          JSON.stringify({
            ...JSON.parse(json),
            gameId: 'chart001',
            initialFen: fen,
            moves,
            states,
            notations: moves,
            chineseNotations: moves,
            analysis: analysed ? analysis : null,
            analysisRequestUrl: analysed ? null : '/chart001/request-analysis',
          }) +
          after,
      )
      .replace(/(<input[^>]*id="xiangqi-engine-enabled"[^>]*?) checked(?:="[^"]*")?/, '$1');
    await route.fulfill({ response, body });
  });
  // A draft at the same starting FEN must not overwrite the recorded game.
  await page.addInitScript(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), {
    key: analysisStorageKey(fen),
    draft: serializeMoveTree(createMoveTreeFromUciMainline(fen, ['e4e5']), fen, ''),
  });
}

for (const width of [390, 900, 1280]) {
  test(`stored analysis renders and navigates without a browser engine at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await nativeFixture(page);
    await page.goto('/analysis#2');
    await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '2');
    await expect(page.locator('#xiangqi-moves .move-eval')).toHaveCount(4);
    await expect(page.locator('#xiangqi-server-analysis-status')).toContainText('20');
    await expect(page.locator('#xiangqi-request-analysis')).toBeHidden();
    const canvas = page.locator('#xiangqi-analysis-chart canvas');
    await expect(canvas).toBeVisible();
    await expect(page.locator('#xiangqi-engine-enabled')).not.toBeChecked();
    await expect
      .poll(() =>
        canvas.evaluate(el => {
          const ctx = (el as HTMLCanvasElement).getContext('2d')!;
          return ctx
            .getImageData(0, 0, (el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height)
            .data.some(value => value > 0);
        }),
      )
      .toBe(true);
    await canvas.focus();
    await canvas.press('Home');
    await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '0');
    await canvas.press('ArrowRight');
    await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '1');
    await canvas.press('End');
    await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '4');
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await canvas.click({ position: { x: 20, y: box!.height / 2 } });
    await expect(page.locator('#xiangqi-board')).toHaveAttribute('data-ply', '1');
    await page.screenshot({ path: `test-results/analysis-chart-${width}.png`, fullPage: true });
    await page.locator('.xiangqi-analysis__tab-add').click();
    await expect(page.locator('#xiangqi-analysis-chart')).toBeHidden();
    await expect(page.locator('#xiangqi-server-analysis')).toBeHidden();
    await page.locator('.xiangqi-analysis__tab-select').first().click();
    await expect(canvas).toBeVisible();
    await expect(page.locator('#xiangqi-request-analysis')).toBeHidden();
  });
}

test('unevaluated games keep the chart hidden and show the request control', async ({ page }) => {
  await nativeFixture(page, false);
  await page.goto('/analysis');
  await expect(page.locator('#xiangqi-request-analysis')).toBeVisible();
  await expect(page.locator('#xiangqi-analysis-chart')).toBeHidden();
  await expect(page.locator('#xiangqi-moves .move-eval')).toHaveCount(0);
});

// Supply any readable study URL from the disposable preview database. Only the
// browser response is replaced; no chapter or source game is written by these tests.
const studyUrl = process.env.STUDY_CHART_FIXTURE_URL;
test.describe('shared study chart', () => {
  test.skip(!studyUrl, 'Set STUDY_CHART_FIXTURE_URL to a readable local study');

  async function fixture(page: Page, concealed = false) {
    await page.route(`**${studyUrl}`, async route => {
      const response = await fetchFixture(route);
      const html = await response.text();
      const body = html.replace(
        /(<script type="application\/json" id="page-init-data">)([\s\S]*?)(<\/script>)/,
        (_match, before, json, after) => {
          const payload = JSON.parse(json);
          delete payload.data.analysis;
          delete payload.study.chapter.serverEval;
          payload.study.chapter.features.computer = true;
          payload.study.chapter.practice = false;
          payload.study.chapter.gamebook = false;
          payload.study.chapter.conceal = concealed ? 0 : undefined;
          payload.data.game.variant = { key: 'xiangqi', name: 'Xiangqi' };
          payload.data.treeParts = states.map((state, index) => ({
            id: index ? String(index).repeat(2) : '',
            ply: state.ply,
            fen: state.fen,
            uci: moves[index - 1],
            san: moves[index - 1],
            xiangqiLegalMoves: [],
            xiangqiCheck: false,
            ...(index ? { eval: analysis.infos[index - 1] } : {}),
          }));
          return before + JSON.stringify(payload) + after;
        },
      );
      await route.fulfill({ response, body });
    });
    await page.goto(studyUrl);
  }

  for (const width of [390, 900, 1280]) {
    test(`stored chapter scores display without Fishnet metadata at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page);
      const canvas = page.locator('canvas.study__server-eval');
      await expect(canvas).toBeVisible();
      await expect(page.locator('.study__metadata')).toBeVisible();
      const box = await canvas.boundingBox();
      expect(box!.width).toBeGreaterThan(200);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: `test-results/study-analysis-chart-${width}.png`, fullPage: true });
      await page.locator('.study__buttons button.share').click();
      await expect(canvas).toBeVisible();
    });
  }

  test('concealed chapter scores do not expose a chart', async ({ page }) => {
    await fixture(page, true);
    await expect(page.locator('.analyse__board')).toBeVisible();
    await expect(page.locator('canvas.study__server-eval')).toHaveCount(0);
  });
});
