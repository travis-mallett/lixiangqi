import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifestPath = process.argv[2];
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const base = new URL(manifest.base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Disposable loopback only');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    extraHTTPHeaders: { sessionId: manifest.users.owner.session },
  });
  await context.addCookies([
    { name: 'lila2', value: `sessionId=${manifest.users.owner.session}`, url: base.origin },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('pageerror', error => console.error(error.message));
  page.on('response', response => {
    if (response.status() >= 400) console.error(response.status(), new URL(response.url()).pathname);
  });
  let serverRequests = 0;
  page.on('websocket', socket =>
    socket.on('framesent', event => {
      if (String(event.payload).includes('requestAnalysis')) serverRequests++;
    }),
  );
  await page.goto(`${base.origin}/study/${manifest.study}/${manifest.chapter}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof site !== 'undefined' && !!site.analysis?.study, undefined, {
    timeout: 30000,
  });
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  if (await page.evaluate(() => site.analysis.study.data.chapter.gamebook)) {
    await page.evaluate(() =>
      site.analysis.study.send('editChapter', {
        id: site.analysis.study.data.chapter.id,
        name: 'Verified native study',
        orientation: 'black',
        mode: 'normal',
        description: '',
      }),
    );
    await page.waitForFunction(
      () => !site.analysis.study.data.chapter.gamebook && !site.analysis.study.vm.loading,
    );
  }
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: manifestPath.replace(/\.json$/, `-${width}.png`), fullPage: true });
    assert.ok(await page.locator('.analyse__board').isVisible(), `Board visible at ${width}px`);
    const chart = page.locator('.study__analysis-chart');
    if (await chart.count())
      assert.ok((await chart.boundingBox()).height < 500, 'Evaluation chart has a bounded responsive height');
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'No horizontal overflow',
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    site.analysis.userJump(site.analysis.mainline[1].path);
    site.analysis.redraw();
  });
  await page.locator('button.comments').click();
  await page.locator('#comment-text').fill('Browser study comment retained across tabs');
  await page.locator('button.glyphs').click();
  await page.locator('button.comments').click();
  assert.equal(
    await page.locator('#comment-text').inputValue(),
    'Browser study comment retained across tabs',
  );
  await page.waitForFunction(() =>
    site.analysis.node.comments?.some(c => c.text === 'Browser study comment retained across tabs'),
  );
  await page.locator('button.glyphs').click();
  await page.locator('.study__glyphs button[data-symbol="!"]').click();
  await page.locator('.study__glyphs button[data-symbol="?"]').click();
  await page.evaluate(() => {
    site.analysis.userJump(site.analysis.mainline[2].path);
    site.analysis.redraw();
  });
  await page.waitForFunction(() => site.analysis.mainline[1].glyphs?.some(g => g.id === 2));
  console.log('PASS browser comment tab switching and rapid glyph edits');
  await page.locator('button.serverEval').click();
  await page.getByRole('button', { name: 'Request a computer analysis', exact: true }).click();
  await page.waitForFunction(
    () => !site.analysis.study.localAnalysis.running && !site.analysis.study.vm.loading,
    undefined,
    { timeout: 180000 },
  );
  const status = await page.evaluate(() => ({
    failed: site.analysis.study.localAnalysis.failed,
    scores: site.analysis.mainline.map(n => n.eval),
  }));
  assert.equal(status.failed, false, 'Browser Pikafish completed and saved');
  assert.ok(
    status.scores.every(e => e && (e.cp !== undefined || e.mate !== undefined)),
    'Every mainline position has a score',
  );
  assert.equal(serverRequests, 0, 'No server-analysis request was sent');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof site !== 'undefined' && !!site.analysis?.study);
  assert.ok(
    await page.evaluate(() => site.analysis.mainline.every(n => n.eval)),
    'Saved scores survive reload',
  );
  await page.evaluate(() =>
    site.analysis.study.send('editChapter', {
      id: site.analysis.study.data.chapter.id,
      name: 'Verified lesson',
      orientation: 'red',
      mode: 'gamebook',
      description: '',
    }),
  );
  await page.waitForFunction(
    () => site.analysis.study.data.chapter.gamebook && !site.analysis.study.vm.loading,
  );
  await page.evaluate(() => {
    site.analysis.userJump('');
    site.analysis.redraw();
  });
  const hint = page.locator('.gamebook-edit .hint textarea');
  const finalHint = 'Final hint ' + Date.now();
  await hint.fill('First hint');
  await hint.fill(finalHint);
  await page.evaluate(() => {
    site.analysis.userJump(site.analysis.mainline[1].path);
    site.analysis.redraw();
  });
  await page.waitForFunction(text => site.analysis.tree.root.gamebook?.hint === text, finalHint);
  await expect
    .poll(async () => {
      const response = await context.request.get(
        `${base.origin}/study/${manifest.study}/${manifest.chapter}`,
        {
          headers: { Accept: 'application/json' },
        },
      );
      return (await response.json()).analysis.tree.gamebook?.hint;
    })
    .toBe(finalHint);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof site !== 'undefined' && !!site.analysis?.study);
  assert.equal(await page.evaluate(() => site.analysis.tree.root.gamebook.hint), finalHint);
  await page.evaluate(() => {
    site.analysis.userJump('');
    site.analysis.study.setGamebookOverride('play');
  });
  await page.waitForFunction(() => site.analysis.study.gamebookPlay?.state.feedback === 'play');
  await page.getByRole('button', { name: 'Get a hint', exact: true }).click();
  assert.ok(await page.getByText(finalHint, { exact: true }).isVisible());
  await page.evaluate(() => site.analysis.playUci(site.analysis.mainline[1].uci));
  await page.waitForFunction(() => site.analysis.study.gamebookPlay?.state.feedback === 'good');
  await page.evaluate(() => site.analysis.study.gamebookPlay.next());
  await page.waitForFunction(() =>
    ['play', 'end'].includes(site.analysis.study.gamebookPlay?.state.feedback),
  );
  for (let moves = 0; moves < 20; moves++) {
    if (await page.evaluate(() => site.analysis.study.gamebookPlay.state.feedback === 'end')) break;
    const path = await page.evaluate(() => site.analysis.path);
    await page.evaluate(() => {
      const ctrl = site.analysis;
      if (ctrl.study.gamebookPlay.state.feedback === 'play')
        ctrl.playUci(ctrl.node.children.find(n => !n.forceVariation).uci);
      else ctrl.study.gamebookPlay.next();
    });
    await page.waitForFunction(previous => site.analysis.path !== previous, path);
  }
  await page.waitForFunction(() => site.analysis.study.gamebookPlay?.state.feedback === 'end');
  await page.evaluate(() =>
    site.analysis.study.send('editChapter', {
      id: site.analysis.study.data.chapter.id,
      name: 'Verified native study',
      orientation: 'black',
      mode: 'normal',
      description: '',
    }),
  );
  await page.waitForFunction(
    () => !site.analysis.study.data.chapter.gamebook && !site.analysis.study.vm.loading,
  );
  console.log('PASS lesson hint persistence, preview feedback, and completion');
  assert.deepEqual(errors, [], 'No browser exceptions');
  console.log('PASS browser Pikafish analysis, local-only request, persistence and responsive Study board');
} finally {
  await browser.close();
}
