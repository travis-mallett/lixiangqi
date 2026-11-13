import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
let script: string, css: string;
test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  css = readFileSync(`public/css/site.${manifest.css.site}.css`, 'utf8');
  script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import {createBoard, standardXiangqi, manchu, threeKingdoms, boardPresentation, positionFromFen} from './ui/board/src';
      import {applyViewerAppearance} from './ui/viewer/src/appearance';
      const url=p=>'http://board.test/assets/'+p;
      for(const [index, definition] of [standardXiangqi,manchu,standardXiangqi,threeKingdoms].entries()){
        const frame=document.createElement('section');document.body.append(frame);
        await applyViewerAppearance(frame,url,'xiangqi-tournament','celestial-lacquer');
        const graph=index===3;
        const position=index===0 ? positionFromFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR',definition)
          : {active:'red',pieces:new Map(graph ? [
            ['shu:4:0',{face:'up',participant:'red',role:'general'}],
            ['wei:4:0',{face:'up',participant:'black',role:'general'}],
            ['wu:4:0',{face:'up',participant:'green',role:'general'}],
            ['wu:2:2',{face:'up',participant:'green',role:'cannon'}],
          ] : [['e1',{face:index===2?'down':'up',participant:'red',role:index===1?'banner':'soldier'}],
               ['e10',{face:index===2?'down':'up',participant:'black',role:index===1?'banner':'soldier'}]])};
        const element=document.createElement('div');element.className='board mini-board';frame.append(element);
        createBoard(element,{definition,position,presentation:boardPresentation('preview','red'),interaction:{mode:'display'},services:{assetUrl:url}});
      }
      document.body.dataset.ready='true';
    `,
      },
      bundle: true,
      conditions: ['source'],
      format: 'esm',
      write: false,
    })
  ).outputFiles[0].text;
});

for (const width of [320, 768, 1440])
  test(`lacquer standard, banner, concealed and kingdom art renders at ${width}px`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.route('http://board.test/assets/**', r =>
      r.fulfill({
        path: resolve('public', new URL(r.request().url()).pathname.slice(8)),
      }),
    );
    await page.setContent(`<style>${css}
      body{margin:0;padding:12px;display:flex;flex-wrap:wrap;gap:16px;background:#676e68}
      section{width:min(600px,calc(100vw - 24px))}
      .board{width:100%;position:relative}.board.graph-board{padding-bottom:0;height:auto}
      </style><body class="piece-images-ready"></body>`);
    await page.addScriptTag({ content: script, type: 'module' });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.board')).toHaveCount(4);
    for (const board of await page.locator('.board').all()) {
      const box = (await board.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThan(100);
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('lacquer-variants.png'), fullPage: true });
  });
