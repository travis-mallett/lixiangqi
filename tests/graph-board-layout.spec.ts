import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import geometry from '../ui/board/src/three-player-geometry.json';

// Exercise the real renderer and built CSS without requiring a server or user data.
const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
let script: string;
let css: string;
test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  css = ['site', 'user.show']
    .map(name => readFileSync(`public/css/${name}.${manifest.css[name]}.css`, 'utf8'))
    .join('\n');
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { createBoard, threeKingdoms, boardPresentation } from './ui/board/src/index';
        for (const element of document.querySelectorAll('[data-perspective]')) {
          createBoard(element, {
            definition: threeKingdoms,
            position: { active: 'red', pieces: new Map(Object.keys(threeKingdoms.geometry.locations)
              .map(key => [key, { face: 'up', participant: 'red', role: 'soldier' }])) },
            presentation: boardPresentation('thumbnail', element.dataset.perspective),
            interaction: { mode: 'display' }, services: { assetUrl: path => path }
          });
        }
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  script = result.outputFiles[0].text;
});

for (const width of [1440, 900, 390]) {
  test(`graph thumbnails retain artwork alignment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.setContent(
      `<style>${css}</style>${['red', 'black', 'green']
        .map(
          perspective => `<div class="game-row">
        <div class="game-row__board" data-perspective="${perspective}"></div>
        <div class="game-row__infos" style="min-height:320px">Tall game details</div>
      </div>`,
        )
        .join('')}<div style="width:200px" data-perspective="red"></div>`,
    );
    await page.addScriptTag({ content: script });
    await expect
      .poll(async () =>
        page.evaluate(geometry => {
          let error = 0;
          for (const board of document.querySelectorAll<HTMLElement>('.graph-board')) {
            if (!board.getBoundingClientRect().width) continue; // History hides boards on narrow screens.
            const surface = board.querySelector<HTMLElement>('.graph-board__surface')!;
            const bounds = surface.getBoundingClientRect();
            const rotation = new DOMMatrix(
              window.getComputedStyle(board.querySelector('.graph-board__artwork')!).transform,
            );
            for (const piece of board.querySelectorAll<HTMLElement>('piece')) {
              const [x, y] =
                geometry.locations[piece.dataset.pieceLocation as keyof typeof geometry.locations];
              const expected = rotation.transformPoint(
                new DOMPoint(
                  (x / geometry.width - 0.5) * bounds.width,
                  (y / geometry.height - 0.5) * bounds.height,
                ),
              );
              const actual = piece.getBoundingClientRect();
              error = Math.max(
                error,
                Math.abs(actual.x + actual.width / 2 - bounds.x - bounds.width / 2 - expected.x),
                Math.abs(actual.y + actual.height / 2 - bounds.y - bounds.height / 2 - expected.y),
              );
            }
          }
          return error;
        }, geometry),
      )
      .toBeLessThan(0.1);
  });
}
