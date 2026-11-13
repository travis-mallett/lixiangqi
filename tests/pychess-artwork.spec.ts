import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { BoardView } from '../ui/board/src';

declare global {
  interface Window {
    artBoards: BoardView[];
  }
}

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
let script: string;
let css: string;

test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  css = readFileSync(`public/css/site.${manifest.css.site}.css`, 'utf8');
  script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
        import { createBoard, standardXiangqi, miniXiangqi, threeKingdoms, boardPresentation, positionFromFen } from './ui/board/src';
        import { applyViewerAppearance } from './ui/viewer/src/appearance';
        const url = p => 'http://board.test/assets/' + p;
        window.artBoards = [];
        for (const [i, set] of ['xiangqi-white', 'xiangqi-white-international'].entries()) {
          const frame = document.querySelectorAll('.frame')[i];
          await applyViewerAppearance(frame, url, 'xiangqi-light-wood', set);
          for (const definition of [standardXiangqi, miniXiangqi, threeKingdoms]) {
            const graph = definition === threeKingdoms;
            const from = graph ? 'shu:4:0' : 'e1', to = graph ? 'shu:4:1' : 'e2';
            const pos = definition === standardXiangqi
              ? positionFromFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR', definition)
              : {active:'red', pieces: new Map([[from,{face:'up',participant:'red',role:'general'}], [graph ? 'wu:4:0' : 'd7', {face:'up',participant:graph?'green':'black',role:'general'}]])};
            const element = document.createElement('div');
            element.className = 'board mini-board'; frame.append(element);
            const board = createBoard(element, {definition, position:pos,
              presentation:boardPresentation('interactive','red'),
              interaction:{mode:'play',participant:'red',destinations:new Map([[from,[to]]]),input:'both',showDestinations:true,onMove:() => {}},
              services:{assetUrl:url}});
            window.artBoards.push(board);
          }
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

for (const width of [1440, 768, 390])
  test(`PyChess artwork aligns and retains a neutral lifted edge at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://board.test/assets/**', route =>
      route.fulfill({
        path: resolve('public', new URL(route.request().url()).pathname.slice('/assets/'.length)),
      }),
    );
    await page.setContent(`<style>${css}
      body { margin:0; background:#302c24; display:flex; flex-wrap:wrap; gap:20px; padding:12px; }
      .frame { width:min(640px, calc(100vw - 24px)); }
      .board { width:100%; position:relative; margin-bottom:20px; }
      .board.graph-board { padding-bottom:0; height:auto; }
      </style><body class="piece-images-ready"><div class="frame"></div><div class="frame"></div></body>`);
    await page.addScriptTag({ content: script, type: 'module' });
    await page.waitForFunction(() => window.artBoards?.length === 6);
    for (const board of await page.locator('.board').all()) {
      expect((await board.boundingBox())!.height).toBeGreaterThan(100);
      const piece = board.locator('piece.white.k-piece, piece[data-piece-location="shu:4:0"]').first();
      const rect = await piece.boundingBox();
      expect(rect).not.toBeNull();
      if (rect) expect(rect.width).toBeGreaterThan(15);
    }
    const selected = page.locator('.board').first().locator('cg-board > piece.white.k-piece');
    await selected.click({ force: true }); // Chessground owns pointer events on cg-board.
    await expect(selected).toHaveClass(/xiangqi-motion-held/);
    await page.evaluate(() => {
      for (const board of window.artBoards)
        board.select(board.getDefinition().geometry.kind === 'graph' ? 'shu:4:0' : 'e1');
    });
    await expect(page.locator('.xiangqi-motion-held')).toHaveCount(6);
    for (const piece of await page.locator('.xiangqi-motion-held').all()) {
      await expect
        .poll(() =>
          piece.evaluate(e => window.getComputedStyle(e).getPropertyValue('--xiangqi-piece-depth-color')),
        )
        .toMatch(/^#[\da-f]{6}$/);
      const color = await piece.evaluate(e =>
        window.getComputedStyle(e).getPropertyValue('--xiangqi-piece-depth-color'),
      );
      const channels = color
        .slice(1)
        .match(/../g)!
        .map(channel => parseInt(channel, 16));
      // The circumference includes the grey bevel, whose neutral material must
      // continue into the sidewall without picking up red or green lettering.
      expect(Math.min(...channels)).toBeGreaterThan(180);
      expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(8);
    }
    await page.screenshot({ path: testInfo.outputPath('held-and-variants.png'), fullPage: true });
    // Freeze actual carry keyframes for visual inspection of both sets on every
    // geometry. Synchronize on animation frames, not a wall-clock delay.
    const moving = await page.evaluate(async () => {
      for (const board of window.artBoards) {
        const graph = board.getDefinition().geometry.kind === 'graph';
        const from = graph ? 'shu:4:0' : 'e1',
          to = graph ? 'shu:4:1' : 'e2';
        const position = board.position(),
          pieces = new Map(position.pieces);
        pieces.set(to, pieces.get(from)!);
        pieces.delete(from);
        board.display({ ...position, pieces, lastMove: [from, to] }, { kind: 'forward' });
      }
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      for (const animation of document.getAnimations()) {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === 'number' && Number.isFinite(duration)) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
      return document.querySelectorAll('.xiangqi-motion-piece').length;
    });
    expect(moving).toBe(6);
    await page.screenshot({ path: testInfo.outputPath('carry-and-variants.png'), fullPage: true });
    // Flip while lifted, then return to idle without a stranded rim or shadow.
    await page.evaluate(() => {
      for (const board of window.artBoards)
        board.setPresentation({ ...board.getPresentation(), perspective: 'black' });
    });
    await expect(page.locator('.xiangqi-motion-piece')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
