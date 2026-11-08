import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enhance, enrichText, isMoreThanText, userPattern } from '../src/richText';
import {
  mentionsUser,
  usernameCompletionPattern,
  usernamePattern,
  usernameSearchPattern,
  userProfileName,
  userProfilePath,
} from '../src/username';

test('Chinese accounts, search and profile URLs', () => {
  for (const name of ['石头', '象棋', '龍馬', '象棋Player88', 'Player_棋', '𠮷野', '棋〇']) {
    assert(usernamePattern.test(name));
    assert(usernameSearchPattern.test(name));
    const url = new URL(userProfilePath(name), 'https://lixiangqi.com');
    assert.equal(decodeURIComponent(url.pathname.split('/')[2]), name);
    assert(isMoreThanText('@' + name));
    assert(enhance('@' + name).includes(`href="${userProfilePath(name)}"`));
    assert(enrichText('https://lixiangqi.com/@/' + name).includes(name + '</a>'));
  }
});

test('profile URL consumers recover names for replies, quotes and moderation', () => {
  const origin = 'https://lixiangqi.com';
  for (const name of ['石头', '象棋Player88', '𠮷野', 'Alice_123']) {
    const anchor = document.createElement('a');
    anchor.href = origin + userProfilePath(name);
    assert.equal(userProfileName(anchor.href, origin), name);
    assert.equal(userProfileName(userProfilePath(name), origin), name);
    assert.equal(userProfileName('/@/' + name, origin), name);
  }
  for (const href of [
    '/@/%25E7%259F%25B3%25E5%25A4%25B4',
    '/@/%zz',
    '/@/%E7',
    '/@/棋%2F手',
    '/@/石头/blog',
    '/@/石头?x=1',
    '/@/石头#games',
    'https://example.com/@/石头',
    undefined,
  ])
    assert.equal(userProfileName(href, origin), undefined);
});

test('forum completion recognizes short Chinese names and supplementary characters', () => {
  for (const name of ['石', '石头', '龍馬', '象棋Player88', '𠮷野', '𠮷'.repeat(30), 'Alice_123'])
    assert.equal(usernameCompletionPattern.exec('hello @' + name)?.[2], name);
  for (const text of ['email@石头', '@棋/手', '@棋😀', '@' + '𠮷'.repeat(31)])
    assert.equal(usernameCompletionPattern.exec(text), null);
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
