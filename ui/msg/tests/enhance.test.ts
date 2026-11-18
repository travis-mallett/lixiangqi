import assert from 'node:assert/strict';
import test from 'node:test';

import { enhance } from '../src/view/enhance';

test('remote photos and animated image services stay links in a private conversation', () => {
  for (const url of [
    'https://i.imgur.com/HFn4lkh.jpeg',
    'https://media.giphy.com/media/abc/giphy.gif',
    'https://example.org/photo.png',
  ]) {
    assert.ok(enhance(url).includes('href="' + url + '"'));
    assert.ok(!enhance(url).includes('<img'));
  }
});

test('bulk message ids should have a text class', () => {
  assert.strictEqual(
    enhance('Your game with @somebody is ready: #gameIdXX.'),
    'Your game with <a target="_blank" rel="nofollow noreferrer" href="/@/somebody">@somebody</a> is ready: ' +
      '<a class="text" target="_blank" rel="nofollow noreferrer" href="/gameIdXX">#gameIdXX</a>.',
  );
});

test('regular game links should not have a text class', () => {
  assert.strictEqual(
    enhance('I played a game: https://lixiangqi.org/GameIdXX'),
    'I played a game: <a target="_blank" rel="nofollow noreferrer" href="https://lixiangqi.org/GameIdXX">lixiangqi.org/GameIdXX</a>',
  );
});

test('external urls are turned into links', () => {
  assert.strictEqual(
    enhance('check out that https://zombo.com website'),
    'check out that <a target="_blank" rel="nofollow noreferrer" href="https://zombo.com">zombo.com</a> website',
  );
});

test('urls in parentheses should be enhanced', () => {
  assert.strictEqual(
    enhance('(https://zombo.com)'),
    '(<a target="_blank" rel="nofollow noreferrer" href="https://zombo.com">zombo.com</a>)',
  );
});
