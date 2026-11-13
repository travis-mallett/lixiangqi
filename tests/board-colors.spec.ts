import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const width of [390, 800, 1440])
  test(`board artwork honors every color control at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
    const css = readFileSync(`public/css/site.${manifest.css.site}.css`, 'utf8');
    await page.setContent(
      '<div class="lixiangqi-board"><cg-board></cg-board><div class="graph-board__artwork"></div></div>',
    );
    await page.addStyleTag({ content: css });
    for (const background of [false, true]) {
      await page.evaluate(background => {
        document.documentElement.classList.toggle('has-background', background);
        for (const [key, value] of Object.entries({
          brightness: 42,
          contrast: 150,
          saturation: 70,
          hue: 25,
          opacity: 60,
        }))
          document.body.style.setProperty(`---board-${key}`, String(value));
      }, background);
      const styles = await page.evaluate(() =>
        [
          window.getComputedStyle(document.querySelector('cg-board')!, '::before'),
          window.getComputedStyle(document.querySelector('.graph-board__artwork')!),
        ].map(style => ({ filter: style.filter, opacity: style.opacity })),
      );
      for (const style of styles) {
        expect(style.filter).toBe('brightness(0.42) contrast(1.5) saturate(0.7) hue-rotate(90deg)');
        expect(style.opacity).toBe('0.6');
      }
    }
  });
