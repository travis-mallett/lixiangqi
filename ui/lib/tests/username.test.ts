import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enhance, enrichText, isMoreThanText, userPattern } from '../src/richText';
import { mentionsUser, usernamePattern, usernameSearchPattern, userProfilePath } from '../src/username';

test('Chinese accounts, search and profile URLs', () => {
  for (const name of ['象棋', '龍馬', '象棋Player88', 'Player_棋', '𠮷野', '棋〇']) {
    assert(usernamePattern.test(name));
    assert(usernameSearchPattern.test(name));
    const url = new URL(userProfilePath(name), 'https://lixiangqi.com');
    assert.equal(decodeURIComponent(url.pathname.split('/')[2]), name);
    assert(isMoreThanText('@' + name));
    assert(enhance('@' + name).includes(`href="${userProfilePath(name)}"`));
    assert(enrichText('https://lixiangqi.com/@/' + name).includes(name + '</a>'));
  }
});

test('code point lengths and rejected characters', () => {
  assert(usernamePattern.test('𠮷'.repeat(30)));
  for (const name of [
    '棋',
    '𠮷'.repeat(31),
    '棋/手',
    '棋%手',
    '棋 手',
    '棋😀',
    '棋\u200b手',
    '棋\u0301',
    '棋神',
  ])
    assert(!usernamePattern.test(name), name);
});

test('mentions consume whole names and respect email and URL boundaries', () => {
  const text = '你好@象棋Player88，@𠮷野！ contact@象棋.com https://example.com/@/象棋';
  assert.deepEqual(
    [...text.matchAll(userPattern)].map(m => m[2]),
    ['象棋Player88', '𠮷野'],
  );
  assert.equal(('@' + '棋'.repeat(31)).match(userPattern), null);
  assert(mentionsUser(text, '象棋player88'));
  assert(!mentionsUser(text, '象棋'));
});
