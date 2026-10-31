import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatRecordedDate } from '../src/gameCatalog.ts';

test('catalog summaries preserve unknown date components without rolling into earlier dates', () => {
  assert.equal(formatRecordedDate('1979-02-00', 'en-US'), 'February 1979');
  assert.equal(formatRecordedDate('1978-00-00', 'en-US'), '1978');
  assert.equal(formatRecordedDate('1979-02', 'en-US'), 'February 1979');
  assert.equal(formatRecordedDate('1978', 'en-US'), '1978');
  assert.equal(formatRecordedDate('1979-02-01 10:00', 'en-US'), 'Feb 1, 1979');
  assert.equal(formatRecordedDate('2024-02-29', 'en-US'), 'Feb 29, 2024');
  assert.equal(formatRecordedDate('1979-02-31', 'en-US'), '1979-02-31');
  assert.equal(formatRecordedDate('0000-00-00', 'en-US'), '—');
  assert.equal(formatRecordedDate(null, 'en-US'), '—');
  assert.match(formatRecordedDate('1979-02-00', 'fr-FR'), /février 1979/);
});
