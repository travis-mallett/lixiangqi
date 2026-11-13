import assert from 'node:assert/strict';
import { test } from 'node:test';

import { feedbackImageAsset, playFeedbackImage } from '../src/feedbackImage';

function mount() {
  const overlay = document.createElement('span');
  const image = document.createElement('img');
  overlay.append(image);
  document.body.append(overlay);
  return image;
}

test('replays share bytes but own independent decoder URLs and release every playback', async t => {
  const revoked: string[] = [];
  let next = 0;
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new Response('image bytes'));
  t.mock.method(URL, 'createObjectURL', () => `blob:playback-${++next}`);
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  await feedbackImageAsset(document, '/replay.webp');
  for (let replay = 0; replay < 12; replay++) {
    const a = mount(),
      b = mount();
    const stopA = playFeedbackImage(a, '/replay.webp', 1200);
    const stopB = playFeedbackImage(b, '/replay.webp', 1200);
    await Promise.resolve();
    assert.notEqual(a.src, b.src);
    assert.equal(a.src, `blob:playback-${replay * 2 + 1}`);
    stopA();
    stopA();
    assert.ok(b.isConnected);
    stopB();
    assert.equal(a.isConnected, false);
  }
  assert.equal(fetcher.mock.callCount(), 1);
  assert.equal(revoked.length, 24);
});

test('loading does not consume playback time and completion releases the image', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => new Response('image bytes'));
  t.mock.method(URL, 'createObjectURL', () => 'blob:slow');
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  await feedbackImageAsset(document, '/slow.webp');
  const image = mount();
  playFeedbackImage(image, '/slow.webp', 1200);
  await Promise.resolve();
  t.mock.timers.tick(3000);
  assert.ok(image.isConnected);
  image.dispatchEvent(new window.Event('load'));
  t.mock.timers.tick(1199);
  assert.ok(image.isConnected);
  t.mock.timers.tick(1);
  assert.equal(image.isConnected, false);
  assert.equal(revoke.mock.callCount(), 1);
});

test('interruption while fetching cannot resurrect an obsolete effect', async t => {
  const response = Promise.withResolvers<Response>();
  t.mock.method(globalThis, 'fetch', () => response.promise);
  const create = t.mock.method(URL, 'createObjectURL', () => 'blob:obsolete');
  const image = mount();
  const stop = playFeedbackImage(image, '/pending.webp', 1200);
  stop();
  response.resolve(new Response('image bytes'));
  await feedbackImageAsset(document, '/pending.webp');
  assert.equal(create.mock.callCount(), 0);
  assert.equal(image.isConnected, false);
});

test('a failed preload is retryable and broken images cannot block later playback', async t => {
  let attempts = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('bytes', { status: ++attempts === 1 ? 503 : 200 }),
  );
  t.mock.method(URL, 'createObjectURL', () => 'blob:retry');
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  await assert.rejects(feedbackImageAsset(document, '/retry.webp'), /503/);
  await feedbackImageAsset(document, '/retry.webp');
  const image = mount();
  playFeedbackImage(image, '/retry.webp', 1200);
  await Promise.resolve();
  image.dispatchEvent(new window.Event('error'));
  assert.equal(image.isConnected, false);
  assert.equal(revoke.mock.callCount(), 1);
  await feedbackImageAsset(document, '/retry.webp');
  assert.equal(attempts, 3);
  const later = mount();
  const stop = playFeedbackImage(later, '/retry.webp', 1200);
  await Promise.resolve();
  assert.equal(later.src, 'blob:retry');
  stop();
});

test('a stalled decoder is bounded and its late load event cannot restart playback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => new Response('image bytes'));
  t.mock.method(URL, 'createObjectURL', () => 'blob:stalled');
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  await feedbackImageAsset(document, '/stalled.webp');
  const image = mount();
  playFeedbackImage(image, '/stalled.webp', 1200);
  await Promise.resolve();
  t.mock.timers.tick(15_000);
  assert.equal(image.isConnected, false);
  assert.equal(image.onload, null);
  image.dispatchEvent(new window.Event('load'));
  t.mock.timers.tick(1200);
  assert.equal(revoke.mock.callCount(), 1);
});
