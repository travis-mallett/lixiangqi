import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { BoardView } from '../ui/board/src';

declare global {
  interface Window {
    stoneBoards: BoardView[];
  }
}

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
        import {createBoard,standardXiangqi,miniXiangqi,manchu,threeKingdoms,boardPresentation,positionFromFen} from './ui/board/src';
        import {boardAssets} from './ui/board/src/catalog';
        import {applyViewerAppearance} from './ui/viewer/src/appearance';
        const url=p=>'http://board.test/assets/'+p;
        const theme=boardAssets.boards.find(b=>b.key==='xiangqi-cracked-stone');
        window.stoneBoards=[];
        for(const [name,definition] of [['Xiangqi',standardXiangqi],['Mini Xiangqi',miniXiangqi],['Three Kingdoms',threeKingdoms],['Manchu+',manchu],['Jieqi',standardXiangqi]]) {
          const frame=document.createElement('section');
          const title=document.createElement('h2');title.textContent=name;frame.append(title);document.body.append(frame);
          await applyViewerAppearance(frame,url,theme.key,theme.matchingPieceSet);
          const graph=definition===threeKingdoms, mini=definition===miniXiangqi;
          const position=name==='Xiangqi' ? positionFromFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR',definition)
            : {active:'red',pieces:new Map(graph ? [
              ['shu:4:0',{face:'up',participant:'red',role:'general'}],
              ['wei:4:0',{face:'up',participant:'black',role:'general'}],
              ['wu:4:0',{face:'up',participant:'green',role:'general'}],
              ['wu:2:2',{face:'up',participant:'green',role:'cannon'}],
            ] : [[mini?'d1':'e1',{face:name==='Jieqi'?'down':'up',participant:'red',role:name==='Manchu+'?'banner':'general'}],
                 [mini?'d7':'e10',{face:name==='Jieqi'?'down':'up',participant:'black',role:'general'}]])};
          const element=document.createElement('div');element.className='board mini-board';frame.append(element);
          window.stoneBoards.push(createBoard(element,{definition,position,presentation:boardPresentation('preview','red'),interaction:{mode:'display'},services:{assetUrl:url}}));
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
  test(`Cracked Stone with its default pieces renders every supported geometry at ${width}px`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(request.url()));
    await page.setViewportSize({ width, height: 1100 });
    await page.route('http://board.test/assets/**', route =>
      route.fulfill({ path: resolve('public', new URL(route.request().url()).pathname.slice(8)) }),
    );
    await page.setContent(`<style>${css}
      body{margin:0;padding:16px;display:flex;flex-wrap:wrap;gap:24px;background:#232a27;color:#e8eae1}
      h2{font:18px sans-serif;margin:0 0 12px} section{width:min(650px,calc(100vw - 32px))}
      .board{width:100%;position:relative}.board.graph-board{padding-bottom:0;height:auto}
      </style><body class="piece-images-ready"></body>`);
    await page.addScriptTag({ content: script, type: 'module' });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.board')).toHaveCount(5);
    for (const board of await page.locator('.board').all()) {
      const box = (await board.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width - 32);
      expect(box.height).toBeGreaterThan(100);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath('cracked-stone-variants.png'), fullPage: true });
    await page.evaluate(() => {
      for (const board of window.stoneBoards)
        board.setPresentation({ ...board.getPresentation(), perspective: 'black' });
    });
    await page.screenshot({ path: info.outputPath('cracked-stone-flipped.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
