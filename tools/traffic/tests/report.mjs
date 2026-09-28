import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

await fs.mkdir('.tools', { recursive: true });
const manifest = JSON.parse(await fs.readFile('public/compiled/manifest.json', 'utf8'));
const xml = await fs.readFile('translation/source/traffic.xml', 'utf8');
const labels = Object.fromEntries(
  [...xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)].map(m => [
    m[1],
    m[2].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'),
  ]),
);
const catalog = {
  board: { default: 'LiXiangQi Default', future: 'A future board option' },
  pieces: { paper: 'Paper pieces' },
  uiTheme: { dark: 'Dark' },
  background: { none: 'Theme default' },
  music: { newtrack: 'A future music track' },
  sound: { standard: 'Standard' },
};
const counts = {
  page: 2000,
  engagedMs: 3e8,
  visibleMs: 4e8,
  boardMs: 2e8,
  solvingMs: 1e8,
  puzzle_completed: 500,
  user_registered: 45,
  visit_closed: 1000,
  quickExit: 150,
  visit_closed_durationMs: 75000000,
  appearance_changed: 31,
  selectedUseMs: 600000,
  selectionEpisodes: 20,
  musicEnabledMs: 5e7,
  effectsEnabledMs: 2e8,
  musicPlayingMs: 4e7,
  search_accepted: 300,
  search_paired: 240,
  search_left: 45,
  cta_clicked: 480,
  cta_exposed: 1800,
  room_entered: 400,
  lcpMs: 120000,
  lcpMsCount: 100,
};
const row = (key, factor = 1) => ({
  key,
  visitors: Math.round(1500 * factor),
  visitorsLower: Math.round(1470 * factor),
  visitorsUpper: Math.round(1530 * factor),
  sessions: Math.round(2000 * factor),
  participants: Math.round(1600 * factor),
  counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round(v * factor)])),
  waitP50: 10000,
  waitP90: 30000,
  waitP95: 60000,
});
function report(url) {
  const from = url.searchParams.get('from') || '2026-08-26';
  const until = url.searchParams.get('until') || '2026-09-25';
  const dimension = url.searchParams.get('dimension') || 'all';
  const keys =
    dimension === 'all'
      ? ['all']
      : dimension === 'board'
        ? ['default', 'future']
        : dimension === 'boardPieces'
          ? ['default|paper', 'future|paper']
          : dimension === 'page'
            ? ['Puzzle.show', 'Puzzle.themes', 'Notation.index']
            : ['first-category', 'second-category'];
  const series = [];
  for (const d = new Date(from); d < new Date(until) && series.length < 500; d.setUTCDate(d.getUTCDate() + 1))
    series.push({
      ...row(undefined, 0.025 + (series.length % 5) * 0.003),
      at: d.toISOString().replace('.000Z', 'Z'),
    });
  return {
    from: from + 'T00:00:00Z',
    until: until + 'T00:00:00Z',
    grain: url.searchParams.get('grain') || 'day',
    dimension,
    summary: row('all'),
    series,
    groups: keys.map((k, i) => row(k, keys.length === 1 ? 1 : i ? 0.35 : 0.65)),
    quality: { processedAt: new Date().toISOString(), retention: 'indefinite' },
    catalog: { appearance: catalog },
    registrationBaseline: 1200,
  };
}
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height, theme] of [
    [1440, 1000, 'light'],
    [900, 1000, 'light'],
    [390, 844, 'light'],
    [1440, 1000, 'dark'],
    [390, 844, 'dark'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://traffic.test/**', async route => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.split('/').pop();
      const json =
        endpoint === 'data'
          ? report(url)
          : endpoint === 'snapshot'
            ? {
                day: '2026-09-24',
                rows: [
                  { dimension: 'accounts', key: 'enabled', count: 1000 },
                  { dimension: 'board', key: 'default', count: 650 },
                  { dimension: 'board', key: 'future', count: 350 },
                ],
              }
            : endpoint === 'searches'
              ? {
                  accepted: 300,
                  paired: 240,
                  roundReady: 235,
                  firstMove: 232,
                  aborted: 8,
                  left: 45,
                  unresolved: 15,
                }
              : endpoint === 'returns'
                ? {
                    size: 400,
                    activated: 230,
                    returns: [
                      { day: 1, eligible: 400, returned: 180 },
                      { day: 7, eligible: 350, returned: 100 },
                      { day: 30, eligible: 200, returned: 40 },
                    ],
                  }
                : endpoint === 'audio'
                  ? {
                      browsers: 1000,
                      musicEnabled: 300,
                      effectsEnabled: 850,
                      users: 800,
                      musicAccounts: 250,
                      effectsAccounts: 700,
                    }
                  : endpoint === 'health'
                    ? {
                        enabled: true,
                        buffered: 0,
                        dropped: 0,
                        rejected: 0,
                        geoAvailable: true,
                        retention: 'indefinite',
                      }
                    : undefined;
      if (json) return route.fulfill({ json });
      if (url.pathname.startsWith('/assets/')) {
        const file = path.resolve('public', url.pathname.slice('/assets/'.length));
        assert(file.startsWith(path.resolve('public') + path.sep));
        const contentType = file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.js')
            ? 'text/javascript'
            : file.endsWith('.woff2')
              ? 'font/woff2'
              : 'application/octet-stream';
        try {
          return await route.fulfill({ body: await fs.readFile(file), contentType });
        } catch {
          return route.fulfill({ status: 404, body: '' });
        }
      }
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en" class="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/lib.theme.all.${manifest.css['lib.theme.all']}.css"><link rel="stylesheet" href="/assets/css/site.${manifest.css.site}.css"><link rel="stylesheet" href="/assets/css/traffic.${manifest.css.traffic}.css"></head><body data-theme="${theme}"><div id="main-wrap"><main class="page-menu traffic-page"><nav class="page-menu__menu"><a href="#">Reports</a><a href="#">Traffic Stats</a></nav><div class="page-menu__content box traffic"><h1>Traffic Stats</h1><p class="traffic__intro">Verification fixture · ${labels.intro}</p><div id="traffic-app"></div></div></main></div><script>window.i18n={traffic:${JSON.stringify(labels)}};</script><script type="module">import {initModule} from '/assets/compiled/traffic.${manifest.js.traffic.hash}.js';initModule();</script></body></html>`,
      });
    });
    await page.goto('http://traffic.test/report/traffic');
    await page.locator('#traffic-app[aria-busy="false"]').waitFor();
    for (const name of [
      'acquisition',
      'puzzles',
      'pages',
      'matchmaking',
      'accounts',
      'appearance',
      'audio',
      'quality',
      'overview',
    ]) {
      await page.locator(`button[data-section="${name}"]`).click();
      await page.locator('#traffic-app[aria-busy="false"]').waitFor();
      await page.locator('canvas').waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
        false,
        `horizontal overflow in ${name} at ${width}/${theme}`,
      );
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: `.tools/traffic-${width}-${theme}.png`, fullPage: true });
    assert.equal(overflow, false, `horizontal overflow at ${width}/${theme}`);
    assert.deepEqual(errors, [], `browser errors at ${width}/${theme}`);
    await page.route('**/report/traffic/data?*', route => route.fulfill({ status: 503, body: '' }));
    await page.locator('button[data-section="pages"]').click();
    await page.locator('#traffic-app[aria-busy="false"]').waitFor();
    assert.equal(await page.locator('canvas').count(), 0, 'failed filters must not leave a stale chart');
    assert.equal(await page.locator('.traffic__status').textContent(), labels.loadError);
    results.push({ width, theme, errors, overflow });
    await page.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
