import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve, extname } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const requireBuild = createRequire(resolve(root, 'ui/.build/package.json'));
const { build } = requireBuild('esbuild');

test(
  'browser selects trained jqe and PikaJieQi, stops workers and handles missing weights',
  { timeout: 120000 },
  async () => {
    const bundled = await build({
      stdin: {
        resolveDir: root,
        contents: `
        import { PikafishBrowserEngine } from './ui/lib/src/ceval/engines/pikafishBrowser';
        import { createAnalysisEngineView, createAnalysisGauge, createAnalysisSettings, createJieqiEngineSelection,
          bindEngineSettings, updateAnalysisEngineIdentity } from './ui/xiangqi/src/analysisEngineView';
        import { analysisEngineConfig } from './ui/xiangqi/src/analysisEngineConfig';
        import { loadEngineSettings, engineSettingsKey } from './ui/xiangqi/src/analysisSettings';
        window.site = { asset: { url: path => '/public/' + path } };
        window.i18n = { site: {
          analysisEngine: 'Engine', multipleLines: 'Multiple lines', toggleLocalEvaluation: 'Local evaluation',
          engineOnDevice: name => name + ' · on your device', engineAnalysisName: name => name + ' analysis',
          engineRedEvaluation: name => name + ' evaluation', engineSettingsName: name => name + ' settings',
          jieqiEngineHelp: 'Candidate moves are evaluated using only the visible information.', engineCandidateMoves: 'Candidate moves'
        }};
        const engineView = createAnalysisEngineView(), gauge = createAnalysisGauge();
        document.body.append(engineView);
        const panel = createAnalysisSettings([
          { name: 'depth', label: 'Search depth', type: 'range', min: 1, max: 20, value: 7 },
          { name: 'multipv', label: 'Multiple lines', type: 'range', min: 1, max: 5, value: 2 }
        ]);
        engineView.querySelector('.xiangqi-engine-settings').replaceWith(panel);
        bindEngineSettings(engineView.querySelector('button'), panel);
        let engine, generation = 0;
        const start = id => {
          const token = ++generation;
          engine?.destroy();
          window.result = null;
          localStorage.setItem(engineSettingsKey('jieqi'), JSON.stringify({ jieqiEngine: id }));
          updateAnalysisEngineIdentity(engineView, gauge, analysisEngineConfig('jieqi', id));
          engine = new PikafishBrowserEngine(status => { window.engineStatus = status; }, undefined, 'jieqi', id);
          engine.start({
            fen: 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w j - 0 1',
            observation: {
              fen: 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w j - 0 1',
              remaining: Object.fromEntries([...'RACPNBracpnb'].map(p => [p, p.toLowerCase() === 'p' ? 5 : 2]))
            },
            legalMoves: ['a4a5', 'b3b10'], search: { nodes: 2500 }, multiPv: 2, threads: 1, hashSize: 16,
            emit: (result, final) => { if (token === generation && final) window.result = result; }
          });
        };
        const selection = createJieqiEngineSelection(start);
        panel.prepend(selection);
        const selected = loadEngineSettings('jieqi').jieqiEngine;
        selection.querySelector('select').value = selected;
        start(selected);
        window.addEventListener('pagehide', () => engine?.destroy());
      `,
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      conditions: ['source'],
      alias: { lib: resolve(root, 'ui/lib/src') },
    });
    const manifest = JSON.parse(await readFile(resolve(root, 'public/compiled/manifest.json'), 'utf8'));
    const cssFiles = Object.entries(manifest.css).filter(([name]) =>
      ['site', 'xiangqi', 'lib.theme.all'].includes(name),
    );
    const server = createServer(async (req, res) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          `<!doctype html><html class="dark"><meta name="viewport" content="width=device-width"><body>${cssFiles.map(([name, value]) => `<link rel="stylesheet" href="/public/css/${name}.${value.hash ?? value}.css">`).join('')}<style>body{margin:20px}.xiangqi-engine{position:relative;max-width:500px}</style><script type="module" src="/fixture.js"></script>`,
        );
      } else if (req.url === '/fixture.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(bundled.outputFiles[0].contents);
      } else {
        const file = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) {
          res.writeHead(403).end();
          return;
        }
        try {
          res.setHeader(
            'Content-Type',
            { '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' }[extname(file)] ??
              'application/octet-stream',
          );
          res.end(await readFile(file));
        } catch {
          res.writeHead(404).end();
        }
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ channel: 'chrome' });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const url = `http://127.0.0.1:${server.address().port}`;
      await page.goto(url);
      await page.waitForFunction(() => window.result?.lines.length === 1);
      assert.match(await page.evaluate(() => window.result.engine), /jqe/);
      await page.locator('.xiangqi-icon-button').click();
      assert.equal(await page.locator('[data-setting="multipv"]').isVisible(), false);
      await mkdir(resolve(root, '.tools/jqe-browser'), { recursive: true });
      for (const width of [390, 800, 1280]) {
        await page.setViewportSize({ width, height: 700 });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
        );
        await page.screenshot({ path: resolve(root, `.tools/jqe-browser/settings-${width}.png`) });
      }
      await page.locator('select').selectOption('pikajieqi');
      await page.waitForFunction(() => window.result?.engine.includes('Pika'));
      assert.equal(await page.locator('[data-setting="multipv"]').isVisible(), true);
      await page.reload();
      await page.waitForFunction(() => window.result?.engine.includes('Pika'));
      await page.locator('.xiangqi-icon-button').click();
      await page.locator('select').selectOption('jqe');
      await page.waitForFunction(() => window.result?.engine.includes('jqe'));
      assert.deepEqual(errors, []);
      await page.route('**/it014.jqn', route => route.fulfill({ status: 404, body: '' }));
      await page.reload();
      await page.waitForFunction(() => window.engineStatus?.state === 'error');
      assert.match(await page.evaluate(() => window.engineStatus.error), /network download failed/);
      assert.equal(await page.evaluate(() => window.result), null);
    } finally {
      await browser?.close();
      await new Promise(resolve => server.close(resolve));
    }
  },
);
