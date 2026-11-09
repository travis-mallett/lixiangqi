import { test, expect } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';

// Read-only browser coverage; run against a local preview or a deployed release.
test.skip(process.env.LOADING_TEST !== '1', 'Set LOADING_TEST=1');

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => (release = resolve));
  return { promise, release };
}

test('slow CSS cannot expose an unstyled body, even with an early Firefox layout flush', async ({ page }) => {
  const css = gate();
  await page.route('**/assets/css/**', async route => {
    await css.promise;
    await route.continue();
  });
  // Model layout reads by an extension/content script while the parser is active.
  await page.addInitScript(() => {
    new MutationObserver(() => document.body?.getBoundingClientRect()).observe(document, {
      childList: true,
      subtree: true,
    });
  });
  const navigation = page.goto('/player', { waitUntil: 'load' });
  try {
    await page.waitForFunction(() =>
      Array.from(document.scripts).some(script => script.textContent?.includes('window.site={load:')),
    );
    expect(await page.evaluate(() => !!document.body)).toBe(false);
  } finally {
    css.release();
    await navigation;
  }
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('#assets-missing')).toHaveCount(0);
});

for (const path of ['/player', '/learn/ancient-manuals']) {
  test(`${path} does not download unused board artwork`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(path, { waitUntil: 'load' });
    await page.evaluate(() => (window.site as any).load);
    expect(
      requests.filter(url => /\/(?:lixiangqi-default|[rb][PAENBRCKM]|xiangqi-.*shadow)\./.test(url)),
    ).toEqual([]);
    await expect(page.locator('main')).toBeVisible();
  });
}

test('board images still initialize when a board is requested from a text-only page', async ({ page }) => {
  await page.goto('/player');
  await page.waitForFunction(() => !!(window.site as any).asset);
  await page.evaluate(async () => {
    await (window.site as any).asset.loadPieces;
  });
  await expect(page.locator('body')).toHaveClass(/piece-images-ready/);
});

test('late text fonts cannot rearrange an already visible leaderboard', async ({ page }) => {
  const fonts = gate();
  await page.route(/\/(?:font|hashed)\/(?:noto-sans|roboto)-.*\.woff2/, async route => {
    await fonts.promise;
    await route.continue();
  });
  const navigation = page.goto('/player', { waitUntil: 'load' });
  const layout = () =>
    page.locator('.page-menu__content').evaluate(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
  let before: Awaited<ReturnType<typeof layout>>;
  try {
    await expect(page.locator('.page-menu__content')).toBeVisible();
    // Model a font response arriving beyond the optional font's short block period.
    // The stylesheet and actual layout are ready before starting this network delay.
    const start = await page.evaluate(() => performance.now());
    await page.waitForFunction(start => performance.now() - start >= 300, start);
    before = await layout();
    expect(
      await page.evaluate(() =>
        Array.from(document.fonts)
          .filter(font => /Noto Sans|Roboto/.test(font.family))
          .every(font => font.display === 'optional'),
      ),
    ).toBe(true);
  } finally {
    fonts.release();
    await navigation;
  }
  await page.evaluate(() => document.fonts.ready);
  expect(await layout()).toEqual(before!);
});

test('font preloads and CSS share one content-addressed URL', async ({ page }) => {
  const fonts = new Set<string>();
  page.on('request', request => {
    if (/\/(?:noto-sans|roboto)-.*\.woff2/.test(request.url())) fonts.add(request.url());
  });
  await page.goto('/player', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.size).toBeGreaterThan(0);
  expect(Array.from(fonts).every(url => /\/hashed\/.*\.[a-f0-9]{8}\.woff2$/.test(url))).toBe(true);
  expect(Array.from(fonts).filter(url => url.includes('noto-sans-latin.'))).toHaveLength(1);
  expect(Array.from(fonts).filter(url => url.includes('roboto-latin.'))).toHaveLength(1);
});

test('the preferences menu waits for its stylesheet', async ({ page }) => {
  await page.goto('/player');
  await page.waitForFunction(() => !!(window.site as any).asset);
  const css = gate();
  const requested = gate();
  await page.route('**/assets/css/dasher.*.css', async route => {
    requested.release();
    await css.promise;
    await route.continue();
  });
  try {
    await page.locator('.dasher .toggle').click();
    await requested.promise;
    await expect(page.locator('#dasher_app .subs')).toHaveCount(0);
  } finally {
    css.release();
  }
  await expect(page.locator('#dasher_app .subs')).toBeVisible();
});

test('homepage More, back navigation and a repeat visit remain usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (let visit = 0; visit < 2; visit++) {
    await page.locator('.lobby__leaderboard a.more').click();
    await expect(page).toHaveURL(/\/player$/);
    await expect(page.locator('.leaderboards')).toBeVisible();
    await expect(page.locator('#assets-missing')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('.lobby__table[aria-busy]')).toHaveCount(0);
    await expect(page.locator('.lobby__leaderboard a.more')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('raw HTML and script-free pages do not contain the misleading network warning', async ({
  request,
  browser,
}) => {
  const response = await request.get('/player');
  const html = await response.text();
  expect(html).not.toMatch(/Your network blocks|assets-missing/);
  const document = new JSDOM(html).window.document;
  expect(document.querySelector('.lichess-logo-svg')?.getAttribute('width')).toBe('50');
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/player');
    await expect(page.locator('main')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('only successful fingerprinted assets receive immutable caching', async ({ request }) => {
  const response = await request.get('/player');
  const document = new JSDOM(await response.text()).window.document;
  const css = document.querySelector('link[data-css-key="site"]')!.getAttribute('href')!;
  const asset = await request.get(css);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  const missing = await request.get('/assets/css/missing.12345678.css');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['cache-control']).toBe('no-store');
  const manifest = await request.get('/assets/compiled/manifest.json');
  expect(manifest.headers()['cache-control']).toBe('no-cache');
  const script = document.querySelector('script[src*="/manifest."]')!.getAttribute('src')!;
  const clientManifest = await request.get(script);
  const digest = createHash('sha256')
    .update(await clientManifest.body())
    .digest('hex')
    .slice(0, 8);
  expect(script).toContain(`/manifest.${digest}.js`);
});

for (const width of [1440, 960, 390]) {
  test(`homepage play controls reserve their layout before JavaScript at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const js = gate();
    await page.route(/\/assets\/.*\.js(?:\?|$)/, async route => {
      await js.promise;
      await route.continue();
    });
    const navigation = page.goto('/', { waitUntil: 'load' });
    let before = 0;
    try {
      await expect(page.locator('.lobby__table[aria-busy="true"]')).toBeVisible();
      await page.evaluate(() => document.fonts.load('16px "Noto Sans"'));
      before = (await page.locator('.lobby__variants').boundingBox())!.y;
    } finally {
      js.release();
      await navigation;
    }
    await expect(page.locator('.lobby__table[aria-busy]')).toHaveCount(0);
    const after = (await page.locator('.lobby__variants').boundingBox())!.y;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `data/local/loading-audit/home-${test.info().project.name}-${width}.png` });
  });
}

test('TV embeds do not request the retired chessground bundle', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/tv/frame', { waitUntil: 'load' });
  expect(requests.filter(url => url.includes('chessground.min.js'))).toEqual([]);
});
