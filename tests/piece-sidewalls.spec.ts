import { expect, test, type Page } from '@playwright/test';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { BoardView } from '../ui/board/src';
import catalog from '../ui/board/src/catalog.json';

declare global {
  interface Window {
    materialBoards: BoardView[];
  }
}

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
test.use({ deviceScaleFactor: 2 });
let script: string, css: string;
test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  css = readFileSync(`public/css/site.${manifest.css.site}.css`, 'utf8');
  script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import {createBoard, standardXiangqi, boardPresentation} from './ui/board/src';
      import {applyViewerAppearance} from './ui/viewer/src/appearance';
      import catalog from './ui/board/src/catalog.json';
      window.materialBoards=[];
      for(const side of ['red','black']) for(const set of catalog.pieceSets){
        const tile=document.createElement('section');tile.className='tile';document.body.append(tile);
        tile.dataset.theme=set.key;tile.dataset.side=side;
        const element=document.createElement('div');element.className='board mini-board';tile.append(element);
        await applyViewerAppearance(tile,p=>'http://board.test/assets/'+p,'xiangqi-light-wood',set.key);
        const board=createBoard(element,{definition:standardXiangqi,
          position:{active:side,pieces:new Map([['e5',{face:'up',participant:side,role:'general'}]])},
          presentation:boardPresentation('interactive','red'),
          interaction:{mode:'play',participant:side,destinations:new Map([['e5',['e6']]]),input:'both',showDestinations:false,onMove:()=>{}},
          services:{assetUrl:p=>'http://board.test/assets/'+p}});
        board.select('e5');window.materialBoards.push(board);
      }
    `,
      },
      bundle: true,
      conditions: ['source'],
      format: 'esm',
      write: false,
    })
  ).outputFiles[0].text;
});

for (const cell of [42, 98])
  test(`opaque curved sidewalls at ${cell}px during selection and landing`, async ({ page }, info) => {
    await page.setViewportSize({
      width: 1240,
      height: 24 + Math.ceil((catalog.pieceSets.length * 2) / 7) * 172,
    });
    await page.route('http://board.test/assets/**', r =>
      r.fulfill({ path: resolve('public', new URL(r.request().url()).pathname.slice(8)) }),
    );
    await page.setContent(`<style>${css}
    html,body{background:transparent!important;margin:0}
    body{display:grid;grid-template-columns:repeat(7,160px);gap:12px;padding:12px}
    .tile{position:relative;width:160px;height:160px;overflow:hidden}
    .board{position:absolute!important;width:${(cell * 900) / 98}px!important;height:${(cell * 1000) / 98}px!important;padding-bottom:0!important;left:${80 - (cell * 450) / 98}px;top:${80 - (cell * 549) / 98}px}
    .board cg-board,.board cg-board::before{background:none!important;box-shadow:none!important}
    .xiangqi-shadow-layer,.xiangqi-motion-shadow-airborne,.xiangqi-lift-origin,piece.ghost,cg-auto-pieces,coords{display:none!important}
    </style><body class="piece-images-ready"></body>`);
    await page.addScriptTag({ content: script, type: 'module' });
    await expect(page.locator('.xiangqi-motion-held')).toHaveCount(catalog.pieceSets.length * 2);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('piece.xiangqi-motion-held')].every(p =>
        (p as HTMLElement).style.getPropertyValue('--xiangqi-piece-depth-image'),
      ),
    );
    for (const phase of ['held', 'landing']) {
      if (phase === 'landing')
        await page.evaluate(async () => {
          for (const b of window.materialBoards) b.select(undefined);
          await new Promise(requestAnimationFrame);
          const animations = document.getAnimations().filter(a => a.effect?.getTiming().duration === 150);
          if (animations.length !== window.materialBoards.length * 4)
            throw new Error(`Expected four landing tracks per piece; got ${animations.length}`);
          for (const a of animations) a.pause();
          await Promise.all(animations.map(a => a.ready));
          for (const a of animations) a.currentTime = 75;
        });
      const geometry = await page.evaluate(() =>
        window.materialBoards.map(b => {
          const piece = b.element.querySelector('piece.xiangqi-motion-piece')!;
          const stack = piece.querySelector('.xiangqi-motion-stack')!;
          const rim = piece.querySelector('.xiangqi-motion-rim')!;
          const rect = piece.getBoundingClientRect(),
            size = rect.width;
          const matrix = new DOMMatrix(window.getComputedStyle(stack).transform);
          const offset = new DOMMatrix(window.getComputedStyle(rim).transform).m42;
          const camera = parseFloat(
            window.getComputedStyle(piece).getPropertyValue('--xiangqi-piece-perspective'),
          );
          const project = (x: number, y: number) => {
            const p = matrix.transformPoint(new DOMPoint(x - size / 2, y - size / 2));
            return [
              rect.x + size / 2 + p.x / (1 - p.z / camera),
              rect.y + size / 2 + p.y / (1 - p.z / camera),
            ];
          };
          return {
            theme: b.element.parentElement!.dataset.theme,
            opacity: window.getComputedStyle(rim).opacity,
            interior: [0.4, 0.5, 0.6].map(t =>
              project(
                size * (0.5 + 0.45 * Math.cos(Math.PI * t)),
                size * (0.5 + 0.45 * Math.sin(Math.PI * t)) + offset - 2,
              ),
            ),
            contour: [0.44, 0.5, 0.56].map(t => {
              const x = size * (0.5 + 0.45 * Math.cos(Math.PI * t)),
                y = size * (0.5 + 0.45 * Math.sin(Math.PI * t)) + offset;
              return { inside: project(x, y - 1.5), outside: project(x, y + 3) };
            }),
          };
        }),
      );
      await page.screenshot({ path: info.outputPath(`${phase}-${cell}.png`) });
      // Isolate the actual sidewall so an opaque face cannot hide a translucent
      // rim. Sample its interior 2 CSS px inside the contour: Chromium's
      // brightness-filter rasterization antialiases the boundary during landing.
      const hidden = await page.addStyleTag({ content: '.xiangqi-motion-face{visibility:hidden!important}' });
      const alpha = await coverage(page, info.outputPath(`${phase}-${cell}-outline`));
      await hidden.evaluate(e => e.remove());
      for (const g of geometry) {
        expect(g.opacity, `${g.theme} ${phase}`).toBe('1');
        for (const point of g.interior)
          expect(alpha(point), `${g.theme} ${phase}: solid interior ${point}`).toBeGreaterThanOrEqual(250);
      }
      for (const g of geometry) {
        for (const { inside, outside } of g.contour) {
          expect(alpha(inside), `${g.theme} ${phase}: complete lower arc ${inside}`).toBeGreaterThanOrEqual(
            245,
          );
          expect(alpha(outside), `${g.theme} ${phase}: round underside ${outside}`).toBeLessThanOrEqual(5);
        }
      }
    }
  });

// Black/white backdrop differences measure actual composited coverage, including
// intermediate animation frames. This also works in Firefox, whose screenshot
// driver does not implement omitBackground.
async function coverage(page: Page, path: string) {
  const images = [];
  for (const background of ['black', 'white']) {
    const style = await page.addStyleTag({ content: `html,body{background:${background}!important}` });
    const png = await page.screenshot({ path: `${path}-${background}.png` });
    const width = png.readUInt32BE(16),
      height = png.readUInt32BE(20);
    const pixels = new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`,
      { font: { loadSystemFonts: false } },
    ).render().pixels;
    images.push({ width, pixels });
    await style.evaluate(e => e.remove());
  }
  return ([x, y]: number[]) => {
    const i = (Math.floor(y * 2) * images[0].width + Math.floor(x * 2)) * 4;
    return 255 - Math.max(...[0, 1, 2].map(c => Math.abs(images[1].pixels[i + c] - images[0].pixels[i + c])));
  };
}
