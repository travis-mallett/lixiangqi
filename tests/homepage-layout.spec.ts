import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');

const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
const css = ['lib.theme.all', 'site', 'lobby', 'dasher']
  .map(name => readFileSync(`public/css/${name}.${manifest.css[name]}.css`, 'utf8'))
  .join('\n');

// Use the built shared header and homepage styles without requiring an account or server.
for (const width of [320, 390, 430, 540, 768, 1024, 1440])
  test(`header and scrollable settings fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 740 });
    await page.setContent(`<html lang="en" class="dark"><head><style>${css}</style></head>
      <body data-user="long-name">
      <header id="top">
        <div class="site-title-nav"><label class="hbg"></label>
          <a class="site-title"><div class="site-icon"><svg></svg></div>
            <div class="site-name"><span class="site-name__primary">lixiangqi</span></div></a>
        </div>
        <div class="site-buttons">
          <button class="link">⌕</button><button class="link">♧</button>
          <button class="link">⚔</button><button class="link">♧</button>
          <div class="dasher shown"><button id="user_tag" class="toggle link">ChineseChessPlayerLongName</button>
            <div id="dasher_app" class="dropdown"><button class="head">Board Pieces</button>
              <div class="ui-theme-grid">${Array.from(
                { length: 24 },
                (_, i) => `<button class="ui-theme-card" style="height:100px">Option ${i}</button>`,
              ).join('')}</div>
            </div>
          </div>
        </div>
      </header><main class="lobby"></main></body></html>`);
    const bounds = await page.locator('#user_tag').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const menu = page.locator('#dasher_app');
    const menuBounds = await menu.boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
    if (width < 1024) {
      expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(740);
      await menu.evaluate(el => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(page.getByRole('button', { name: 'Option 23', exact: true })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath('header.png') });
  });

test('Three Kingdoms embed starts image readiness and reveals a populated board', async ({ page }) => {
  await page.route('http://homepage.test/', route => route.fulfill({ body: '<html lang="en"></html>' }));
  await page.goto('http://homepage.test/');
  const state = {
    turn: 'red',
    checked: [],
    pieces: [
      { location: 'shu:0:0', army: 'red', role: 'chariot' },
      { location: 'wu:0:0', army: 'black', role: 'chariot' },
      { location: 'wei:0:0', army: 'green', role: 'chariot' },
    ],
  };
  const result = await build({
    entryPoints: ['ui/threeKingdoms/src/threeKingdoms.embed.ts'],
    bundle: true,
    conditions: ['source'],
    write: false,
    format: 'iife',
    plugins: [
      {
        name: 'fixture-rules',
        setup(builder: any) {
          builder.onResolve({ filter: /^\.\/runtime$/ }, () => ({ path: 'rules', namespace: 'fixture' }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `export async function loadRules() { return { inspect: () => (${JSON.stringify(state)}) }; }`,
          }));
        },
      },
    ],
  });
  await page.setContent(`<style>${css}</style><a id="three-kingdoms-embed"
    data-computer-label="Computer" data-guest-label="Anonymous" style="display:block;width:320px"></a>`);
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
    (window as any).site = {
      pieceImages: {
        get ready() {
          document.body.classList.add('piece-images-ready');
          return Promise.resolve();
        },
      },
    };
    (window as any).EventSource = class {
      set onmessage(callback: (event: { data: string }) => void) {
        callback({
          data: JSON.stringify({
            id: 'testgame',
            position: 'fixture',
            seats: [{ color: 'red' }, { color: 'black' }, { color: 'green' }],
          }),
        });
      }
      close() {}
    };
  });
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.evaluate(() => window.dispatchEvent(new Event('load')));
  await expect(page.locator('.graph-board piece')).toHaveCount(state.pieces.length);
  await expect(page.locator('.graph-board piece').first()).toBeVisible();
  await expect(page.locator('#three-kingdoms-embed')).toHaveAttribute(
    'href',
    '/three-kingdoms/game/testgame',
  );
});
