import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { BoardPosition, BoardView } from '../ui/board/src';

declare global {
  interface Window {
    boards: BoardView[];
    positions: [BoardPosition, BoardPosition][];
    populate(): void;
  }
}

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
let script: string;
let css: string;
test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  css = readFileSync(process.env.BOARD_RENDER_CSS ?? `public/css/site.${manifest.css.site}.css`, 'utf8');
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { createBoard, standardXiangqi, miniXiangqi, threeKingdoms, boardPresentation, positionFromFen } from './ui/board/src';
        import catalog from './ui/board/src/catalog.json';
        const style = document.body.style;
        const url = path => 'url("http://board.test/assets/' + path + '")';
        const theme = catalog.pieceSets[0];
        for (const [family, variant] of Object.entries(theme.variants))
          for (const [side, roles] of Object.entries(variant.faces))
            for (const [role, path] of Object.entries(roles)) {
              style.setProperty('---' + family + '-' + side + '-' + role, url(path));
              if (family === 'xiangqi') style.setProperty('---' + side + '-' + role, url(path));
            }
        for (const [geometry, path] of Object.entries(catalog.boards[0].geometries))
          style.setProperty('---board-image-' + geometry, url(path));
        style.setProperty('--xiangqi-rest-shadow-image', url(catalog.shadows.rest));
        style.setProperty('--xiangqi-airborne-shadow-image', url(catalog.shadows.airborne));
        window.boards = [];
        window.positions = [];
        for (const [i, definition] of [standardXiangqi, miniXiangqi, threeKingdoms].entries()) {
          const graph = definition.geometry.kind === 'graph';
          const from = graph ? 'wei:4:0' : 'e1', to = graph ? 'wei:4:1' : 'e2';
          const piece = {face:'up', participant:'red', role:'general'};
          const before = {active:'red', pieces:new Map([[from,piece]]), checked:[from]};
          const after = {...before, pieces:new Map([[to,piece]]), checked:[to], lastMove:[from,to]};
          const element = document.querySelectorAll('.fixture')[i];
          const board = createBoard(element, {definition, position:before,
            presentation:boardPresentation('replay','red'), interaction:{mode:'display'},
            services:{assetUrl:path=>'http://board.test/assets/'+path}});
          window.boards.push(board); window.positions.push([before, after]);
        }
        window.populate = () => {
          const initial = positionFromFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR', standardXiangqi);
          for (let i=0; i<6; i++) {
            const frame = document.createElement('div'); frame.className = 'fixture-frame'; document.body.append(frame);
            const element = document.createElement('div'); element.className = 'fixture mini-board'; frame.append(element);
            window.boards.push(createBoard(element, {definition:standardXiangqi, position:initial,
              presentation:boardPresentation('replay','red'), interaction:{mode:'display'}, services:{assetUrl:path=>'http://board.test/assets/'+path}}));
          }
        };
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  script = result.outputFiles[0].text;
});

async function mount(page: Page) {
  await page.route('http://board.test/assets/**', route => {
    const path = new URL(route.request().url()).pathname.slice('/assets/'.length);
    return route.fulfill({ path: resolve('public', path) });
  });
  await page.setContent(`<style>${css}
    body { margin:0; display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start; }
    .fixture-frame { width:min(350px, 90vw); }
    .fixture { width:100%; position:relative; }
    </style><body class="piece-images-ready" style="---board-brightness:100;---board-contrast:100;---board-saturation:100;---board-hue:0;---board-opacity:100">
    <div class="fixture-frame"><div class="fixture mini-board"></div></div>
    <div class="fixture-frame"><div class="fixture mini-board"></div></div>
    <div class="fixture-frame"><div class="fixture"></div></div></body>`);
  await page.addScriptTag({ content: script });
  await page.evaluate(async () => {
    const urls = [...document.body.style].map(key => document.body.style.getPropertyValue(key));
    await Promise.all(
      urls
        .filter(value => value.startsWith('url('))
        .map(async value => {
          const image = new Image();
          image.src = value.slice(5, -2);
          await image.decode();
        }),
    );
    await new Promise(requestAnimationFrame);
  });
}

for (const width of [1440, 900, 390]) {
  test(`pieces, check halos and shadows stay together at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await mount(page);
    await page.evaluate(() => window.populate());
    const errors = await page.evaluate(async () => {
      const { positions } = window;
      const boards = window.boards.slice(0, 3);
      const errors: string[] = [];
      for (let step = 0; step < 24; step++) {
        boards.forEach((board, i) =>
          board.display(positions[i][step % 2], { kind: step % 2 ? 'forward' : 'backward' }),
        );
        window.scrollTo(0, step % 2 ? document.body.scrollHeight : 0);
        // Interrupt at different phases, including actual carry and landing.
        for (let frame = 0; frame <= step % 7; frame++) await new Promise(requestAnimationFrame);
        for (const board of boards) {
          const halo = board.element.querySelector('.xiangqi-check-halo')!;
          const root = halo?.closest('piece');
          if (!root) {
            errors.push('orphaned/missing halo');
            continue;
          }
          const face = root.querySelector('.xiangqi-motion-face') ?? root;
          const a = halo.getBoundingClientRect(),
            b = face.getBoundingClientRect();
          if (Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2) > 2)
            errors.push('halo escaped face: ' + board.getDefinition().id);
          const shadow = board.element.querySelector('.xiangqi-piece-shadow')!;
          if (window.getComputedStyle(root).transform !== window.getComputedStyle(shadow).transform)
            errors.push('shadow travel differs');
          for (const square of board.element.querySelectorAll('square.check, .graph-board__location.check'))
            if (window.getComputedStyle(square, '::after').content !== 'none')
              errors.push('square paints detached check');
        }
      }
      for (const [i, board] of boards.entries())
        board.display({ ...positions[i][0], checked: [] }, { kind: 'jump' });
      await new Promise(requestAnimationFrame);
      if (document.querySelector('.xiangqi-check-halo')) errors.push('stale check after jump');
      return errors;
    });
    expect(errors).toEqual([]);
  });
}

test('resting multi-board pages do not reserve a compositor layer per piece or shadow', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium exposes compositor layers through CDP');
  await page.setViewportSize({ width: 1440, height: 1800 });
  const client = await page.context().newCDPSession(page);
  let layers: { drawsContent: boolean }[] = [];
  client.on('LayerTree.layerTreeDidChange', event => {
    layers = event.layers ?? [];
  });
  await client.send('LayerTree.enable');
  await mount(page);
  await page.evaluate(() => window.populate());
  await expect.poll(() => layers.filter(layer => layer.drawsContent).length).toBeGreaterThan(1);
  // Six additional full boards contain 192 pieces and 192 contact shadows.
  await page.screenshot({ path: test.info().outputPath('resting-boards.png') });
  console.log('Resting board content layers:', layers.filter(layer => layer.drawsContent).length);
  expect(layers.filter(layer => layer.drawsContent).length).toBeLessThan(40);
  await client.detach();
});
