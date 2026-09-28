import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
const requireBuild = createRequire(new URL('../../../ui/.build/package.json', import.meta.url));
const { build } = requireBuild('esbuild');
const bundle = await build({
  stdin: {
    contents: `import {initTraffic,trackTraffic,trafficBoundary} from './ui/lib/src/traffic.ts'; window.trafficTest={trackTraffic,trafficBoundary}; initTraffic();`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  minify: true,
  format: 'esm',
  external: ['web-vitals'],
  platform: 'browser',
});
const script = bundle.outputFiles[0].text;
console.log(
  `Collector standalone bundle: ${script.length} bytes; gzip ${gzipSync(script).length} bytes (vitals loaded separately)`,
);
const waitFor = async predicate => {
  const until = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Timed out waiting for browser delivery');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const browser = await chromium.launch({ headless: true });
try {
  for (const optedOut of [false, true]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const received = [];
    const accepted = [];
    const errors = [];
    let failing = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(
      ({ optedOut }) => {
        window.site = {
          sound: { isMusicEnabled: () => true, isSoundEnabled: () => true, getVolume: () => 1 },
        };
        Math.random = () => 0.9;
        if (optedOut) Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
      },
      { optedOut },
    );
    await page.route('http://collector.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/traffic/events') {
        const batch = JSON.parse(route.request().postData());
        received.push(batch);
        if (!failing) accepted.push(batch);
        return route.fulfill({ status: failing ? 503 : 204, body: '' });
      }
      if (url.pathname === '/collector.js')
        return route.fulfill({ body: script, contentType: 'text/javascript' });
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><body data-traffic="true" data-traffic-page="Puzzle.show" data-board="new-catalog-board" data-piece-set="new-catalog-pieces" data-ui-theme="new-catalog-ui" data-background="none" data-music-set="new-catalog-music" data-sound-set="standard"><div class="main-board">Test board</div><script type="module" src="/collector.js"></script></body></html>`,
      });
    });
    await page.clock.install();
    await page.goto('http://collector.test/');
    await page.clock.runFor(65000);
    if (optedOut) {
      assert.equal(received.length, 0);
      console.log('GPC: no collection');
      await context.close();
      continue;
    }
    await page.waitForFunction(() => sessionStorage.getItem('traffic.outbox')?.includes('"events":[]'));
    const attention = received.flatMap(b => b.events).find(e => e.kind === 'attention');
    assert(attention && attention.values.engagedMs >= 59000 && attention.values.engagedMs <= 61000);
    assert.equal(attention.dimensions.board, 'new-catalog-board');
    await page.evaluate(() => {
      window.trafficTest.trafficBoundary();
      document.body.dataset.board = 'another-future-board';
      window.trafficTest.trackTraffic('appearance.changed', {
        component: 'board',
        previous: 'new-catalog-board',
      });
      window.trafficTest.trafficBoundary();
    });
    await page.clock.runFor(65000);
    await waitFor(() => received.some(b => b.events.some(e => e.kind === 'appearance.changed')));
    const change = received.flatMap(b => b.events).find(e => e.kind === 'appearance.changed');
    assert(change && change.values.selectedUseMs >= 59000);
    failing = true;
    await page.evaluate(() => {
      window.trafficTest.trackTraffic('cta.clicked', { placement: 'test' });
      window.trafficTest.trafficBoundary();
    });
    await page.waitForFunction(() =>
      JSON.parse(sessionStorage.getItem('traffic.outbox') || '{}').events?.some(
        e => e.kind === 'cta.clicked',
      ),
    );
    const retained = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('traffic.outbox')).events.map(e => e.id),
    );
    failing = false;
    await page.goto('http://collector.test/next');
    await page.clock.runFor(65000);
    await waitFor(() => retained.every(id => accepted.some(b => b.events.some(e => e.id === id))));
    const delivered = new Set(accepted.flatMap(b => b.events.map(e => e.id)));
    assert(retained.every(id => delivered.has(id)));
    assert.deepEqual(errors, []);
    console.log('Minute attention, dynamic options, switch episodes and navigation retry IDs passed');
    await context.close();
  }
} finally {
  await browser.close();
}
