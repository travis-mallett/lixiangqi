import { expect, test, type Page } from '@playwright/test';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
let script: string;
let css: string;
test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  css = readFileSync(`public/css/site.${manifest.css.site}.css`, 'utf8');
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { createBoard, boardDefinition, boardPresentation } from './ui/board/src';
        const [variant, role] = location.pathname.slice(1).split('/');
        const definition = boardDefinition(variant === 'jieqi' ? 'xiangqi' : variant);
        const graph = definition.geometry.kind === 'graph';
        const side = graph ? 'green' : 'red';
        const piece = variant === 'jieqi' ? { face: 'down', participant: side } : { face: 'up', participant: side, role };
        const board = document.querySelector('.cg-wrap');
        const image = (key, path) => board.style.setProperty(key, 'url("/image/' + path + '")');
        image('---board-image-' + definition.geometry.id, 'art');
        image('--xiangqi-rest-shadow-image', 'rest');
        image('--xiangqi-airborne-shadow-image', 'airborne');
        for (const color of definition.participants) {
          image('--board-piece-back-' + color, 'back-' + color);
          for (const role of Object.keys(definition.roles))
            image('---' + (graph ? 'threeKingdoms-' : '') + color + '-' + role, color + '-' + role);
        }
        window.mountBoard = () => createBoard(board, {
          definition, position: { active: side, pieces: new Map([[graph ? 'wu:4:2' : 'd4', piece]]) },
          presentation: boardPresentation('preview', side), interaction: { mode: 'display' },
          services: { assetUrl: () => '/image/coordinates' },
        });
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  script = result.outputFiles[0].text;
});

// Count three unambiguous colors in a real screenshot, including the shadow
// extending beyond the face. DOM visibility alone cannot detect a missing texture.
function paintedLayers(png: Buffer) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="240" height="240"><image width="240" height="240" xlink:href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
  const { pixels } = new Resvg(svg).render();
  const seen = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (g > 230 && r < 20 && b < 20) seen.add('art');
    if (r > 230 && g < 20 && b < 20) seen.add('face');
    if (b > 230 && r < 20 && g < 20) seen.add('shadow');
  }
  return [...seen].sort();
}

// Sample frames that Chromium actually composites during scrolling. Each scroll
// offset places the entire board either inside or outside the viewport.
async function checkScrollFrames(page: Page) {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.addStyleTag({ content: 'body{padding-top:400px}html{scroll-behavior:auto!important}' });
  const session = await page.context().newCDPSession(page);
  const frames: string[] = [];
  session.on('Page.screencastFrame', ({ data, sessionId }) => {
    frames.push(data);
    void session.send('Page.screencastFrameAck', { sessionId });
  });
  try {
    await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await page.evaluate(async () => {
      for (let i = 0; i < 48; i++) {
        window.scrollTo(0, i % 4 ? (i * 37) % 380 : document.body.scrollHeight);
        await new Promise(requestAnimationFrame);
      }
    });
    await session.send('Page.stopScreencast');
  } finally {
    await session.detach();
  }
  const samples = frames.map(data => paintedLayers(Buffer.from(data, 'base64')));
  expect(samples.filter(layers => layers.length === 3).length).toBeGreaterThan(2);
  expect(samples).toContainEqual([]);
  expect(samples.filter(layers => layers.length === 1 || layers.length === 2)).toEqual([]);
}

for (const [variant, role, delayed] of [
  ['xiangqi', 'general', 'art'],
  ['xiangqi', 'horse', 'rest'],
  ['minixiangqi', 'cannon', 'red-cannon'],
  ['jieqi', 'soldier', 'back-red'],
  ['manchu', 'banner', 'red-banner'],
  ['threeKingdoms', 'general', 'green-general'],
]) {
  test(`${variant} paints a complete position with slow ${delayed} on load, reload and scroll`, async ({
    page,
    browserName,
  }) => {
    let hold = Promise.withResolvers<void>();
    let requested = Promise.withResolvers<void>();
    await page.route('http://board.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/image/'))
        return route.fulfill({
          contentType: 'text/html',
          body: `<style>${css}
          body {margin:0; background:white; min-height:300vh}
          body {---board-image:linear-gradient(lime,lime)}
          .frame {width:240px;height:240px;position:relative;background:white}
          .cg-wrap {width:100%;height:100%;position:relative}
          </style><body class="simple-board is2d"><div class="frame"><div class="cg-wrap"><cg-container><cg-board></cg-board></cg-container></div></div></body>`,
        });
      const key = path.slice('/image/'.length);
      if (key === delayed) {
        requested.resolve();
        await hold.promise;
      }
      const fill = key === 'art' ? 'lime' : key === 'rest' ? 'blue' : 'red';
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${fill}"/></svg>`,
      });
    });
    for (const refresh of [false, true]) {
      if (refresh) await page.reload();
      else await page.goto(`http://board.test/${variant}/${role}`);
      await page.addScriptTag({ content: script });
      const frame = page.locator('.frame');
      // The server's empty board must reserve space without painting its artwork.
      await expect(page.locator('cg-board')).toBeHidden();
      await page.evaluate(() => {
        (window as any).mountBoard();
      });
      await requested.promise;
      try {
        await expect(frame.locator('piece').first()).toBeHidden();
        expect(paintedLayers(await frame.screenshot())).toEqual([]);
      } finally {
        hold.resolve();
      }
      await expect(frame.locator('.board-assets-ready')).toBeVisible();
      const complete = await frame.screenshot();
      expect(paintedLayers(complete)).toEqual(['art', 'face', 'shadow']);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(async () => {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(requestAnimationFrame);
          window.scrollTo(0, 0);
          await new Promise(requestAnimationFrame);
        });
        expect(await frame.screenshot()).toEqual(complete);
      }
      if (refresh && browserName === 'chromium') await checkScrollFrames(page);
      hold = Promise.withResolvers<void>();
      requested = Promise.withResolvers<void>();
    }
  });
}
