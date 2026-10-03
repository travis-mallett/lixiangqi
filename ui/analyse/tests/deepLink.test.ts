import assert from 'node:assert/strict';
import { test } from 'node:test';

import { broadcasterDeepLink } from '../src/study/relay/deepLink';

test('creates deep link from URL', () => {
  assert.equal(
    broadcasterDeepLink('https://lixiangqi.org/broadcast/xiangqi-championship/round-1/xSCoiNg0'),
    'lixiangqi-broadcaster://open?url=https%3A%2F%2Flixiangqi.org%2Fbroadcast%2Fxiangqi-championship%2Fround-1%2FxSCoiNg0',
  );
});

test('retains the destination server including local development ports', () => {
  assert.equal(
    broadcasterDeepLink('http://localhost:9663/broadcast/native/round-1/xSCoiNg0'),
    'lixiangqi-broadcaster://open?url=http%3A%2F%2Flocalhost%3A9663%2Fbroadcast%2Fnative%2Fround-1%2FxSCoiNg0',
  );
});

test('throws on invalid URL', () => {
  assert.throws(() => broadcasterDeepLink('invalid-url'), /TypeError: Invalid URL/);
});
