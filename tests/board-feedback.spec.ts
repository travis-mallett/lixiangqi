import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
let script: string;
let css: string;
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  css = readFileSync(`public/css/site.${manifest.css.site}.css`, 'utf8');
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { BoardFeedback } from './ui/board/src/feedback';
        import { boardPresentation } from './ui/board/src';
        const presentation = boardPresentation('replay', 'red');
        const boards = [...document.querySelectorAll('.fixture')].map(root =>
          new BoardFeedback(root, { assetUrl: path => '/assets/' + path }));
        window.play = effect => boards.forEach(board => board.present({kind:'forward', effects:[effect]}, presentation));
        window.reset = () => boards.forEach(board => board.present({kind:'jump'}, presentation));
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  script = result.outputFiles[0].text;
  // Playwright request routing disables the HTTP cache. Use a real cacheable
  // asset server so this test exercises the browser's normal image caching.
  server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (
      /^\/assets\/images\/board-animations\/lixiangqi-default\/(capture|check|checkmate)\/animation.webp$/.test(
        path,
      )
    ) {
      response.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=3600' });
      response.end(readFileSync(resolve('public', path.slice('/assets/'.length))));
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}
        body { margin:0; background:white; }
        .fixture { position:relative; width:350px; height:380px; background:white; }
        </style><div class="fixture"></div><div class="fixture"></div>`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing feedback fixture server');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await server?.[Symbol.asyncDispose]();
});

for (const width of [390, 900, 1440]) {
  test(`capture, check and mate visibly restart across boards and replay at ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 950 });
    const requests = new Map<string, number>();
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/assets/')) requests.set(path, (requests.get(path) ?? 0) + 1);
    });
    await page.goto(origin);
    await page.addScriptTag({ content: script });
    const fixtures = page.locator('.fixture');
    const blank = await fixtures.first().screenshot();
    const urls = new Set<string>();
    for (let replay = 0; replay < 3; replay++) {
      for (const effect of ['capture', 'check', 'checkmate']) {
        await page.evaluate(effect => (window as any).play(effect), effect);
        const images = page.locator('.xiangqi-board-animation img');
        await expect(images).toHaveCount(2);
        await expect
          .poll(() =>
            images.evaluateAll(
              elements =>
                elements.length === 2 &&
                elements.every(
                  e => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0,
                ),
            ),
          )
          .toBe(true);
        for (const src of await images.evaluateAll(elements =>
          elements.map(e => (e as HTMLImageElement).src),
        )) {
          expect(src).toMatch(/^blob:/);
          expect(urls.has(src)).toBe(false);
          urls.add(src);
        }
        // Verify painted pixels, not merely an overlay node: transparent final frames
        // from a cached, exhausted decoder must not pass this regression.
        for (const fixture of await fixtures.all())
          await expect
            .poll(async () => !(await fixture.screenshot()).equals(blank), {
              message: `${effect} must paint visible pixels on replay ${replay + 1}`,
              intervals: [30],
              timeout: 1000,
            })
            .toBe(true);
        await expect(images).toHaveCount(0);
      }
      await page.evaluate(() => (window as any).reset());
    }
    expect([...requests.values()]).toEqual([1, 1, 1]);
  });
}
