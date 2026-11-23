import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyBoardAppearance, preloadBoardImages } from '../src/appearance';

function fixture() {
  const dom = new JSDOM('<body data-board="wood" data-piece-set="wood">', { url: 'https://board.test/' });
  const doc = dom.window.document;
  const requests = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
  Object.defineProperty(dom.window.HTMLImageElement.prototype, 'decode', {
    value(this: HTMLImageElement) {
      const pending = Promise.withResolvers<void>();
      requests.set(new URL(this.src).pathname, pending);
      return pending.promise;
    },
  });
  const select = (key: string) =>
    applyBoardAppearance(
      doc,
      {
        '---board-image': `url("/${key}/board.svg")`,
        '---red-banner': `url("/${key}/banner.svg")`,
      },
      key,
      key,
      { '---cg-ccw': key },
    );
  return { doc, requests, select };
}

test('the previous appearance remains complete while rapidly selecting board and piece themes', async () => {
  const { doc, requests, select } = fixture();
  const first = select('first');
  const second = select('second');
  requests.get('/second/board.svg')!.resolve();
  assert.equal(doc.body.dataset.board, 'wood');
  requests.get('/second/banner.svg')!.resolve();
  assert.equal(await second, true);
  requests.get('/first/board.svg')!.resolve();
  requests.get('/first/banner.svg')!.resolve();
  assert.equal(await first, false);
  assert.equal(doc.body.dataset.board, 'second');
  assert.equal(doc.body.dataset.pieceSet, 'second');
  assert.equal(doc.body.style.getPropertyValue('---red-banner'), 'url("/second/banner.svg")');
  assert.equal(doc.body.style.getPropertyValue('---cg-ccw'), 'second');
});

test('reselecting the displayed theme cancels a pending replacement', async () => {
  const { doc, requests, select } = fixture();
  const pending = select('paper');
  assert.equal(await select('wood'), true);
  for (const request of requests.values()) request.resolve();
  assert.equal(await pending, false);
  assert.equal(doc.body.dataset.board, 'wood');
});

test('failed replacements retain the displayed artwork and retry only the failed image', async () => {
  const { doc, requests, select } = fixture();
  const pending = select('paper');
  const art = requests.get('/paper/board.svg')!;
  art.resolve();
  requests.get('/paper/banner.svg')!.reject(new Error('image unavailable'));
  await assert.rejects(pending, /image unavailable/);
  assert.equal(doc.body.dataset.board, 'wood');
  assert.equal(doc.body.style.getPropertyValue('---board-image'), '');
  const retry = select('paper');
  requests.get('/paper/banner.svg')!.resolve();
  assert.equal(await retry, true);
  assert.equal(requests.get('/paper/board.svg'), art);
});

test('multiple boards share inflight and decoded images by resolved URL', async () => {
  const { doc, requests } = fixture();
  const a = preloadBoardImages(doc, ['url("/face.svg")']);
  const request = requests.get('/face.svg')!;
  const b = preloadBoardImages(doc, ['url(https://board.test/face.svg)']);
  assert.equal(requests.get('/face.svg'), request);
  request.resolve();
  await Promise.all([a, b]);
  await preloadBoardImages(doc, ['url(face.svg)']);
  assert.equal(requests.get('/face.svg'), request);
});
