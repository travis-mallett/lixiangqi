import assert from 'node:assert/strict';
import { test } from 'node:test';

test('interface date formatting is independent of the article language', async () => {
  document.documentElement.lang = 'zh-Hans';
  document.body.lang = 'vi';
  const { displayLocale } = await import('../src/i18n');
  assert.equal(displayLocale, 'vi');
});
