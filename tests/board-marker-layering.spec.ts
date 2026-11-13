import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// All rectangular variants share square destinations; Three Kingdoms uses buttons.
for (const variant of ['xiangqi', 'jieqi', 'manchu', 'minixiangqi', 'threeKingdoms'])
  for (const width of [390, 800, 1440])
    test(`${variant} legal dots cover history and capture faces at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
      const css = readFileSync(`public/css/site.${manifest.css.site}.css`, 'utf8');
      const graph = variant === 'threeKingdoms';
      const surface = graph ? 'div' : 'cg-board';
      const location = graph ? 'button' : 'square';
      await page.setContent(`<style>${css}</style>
        <div class="lixiangqi-board ${graph ? 'graph-board' : ''}">
          <${surface} class="board-surface" style="position:relative;width:300px;height:300px">
            <${location} class="xiangqi-move-dest ${graph ? 'graph-board__location' : ''}"></${location}>
            <span class="board-marker last-move-origin"></span>
            <span class="board-marker last-move-destination xiangqi-motion-underlay"></span>
            <piece></piece>
          </${surface}>
        </div>`);
      const dot = page.locator('.xiangqi-move-dest');
      for (const occupied of [false, true]) {
        await dot.evaluate((el, occupied) => el.classList.toggle('oc', occupied), occupied);
        const layers = await page.evaluate(() => {
          const z = (selector: string) =>
            Number(window.getComputedStyle(document.querySelector(selector)!).zIndex);
          return {
            dot: z('.xiangqi-move-dest'),
            origin: z('.last-move-origin'),
            destination: z('.last-move-destination'),
            piece: z('piece'),
          };
        });
        expect(layers.dot).toBeGreaterThan(layers.origin);
        expect(layers.dot).toBeGreaterThan(layers.destination);
        expect(layers.dot).toBeGreaterThan(layers.piece);
      }
    });
