import assert from 'node:assert/strict';
import { test } from 'node:test';

import { notationAnnotations, notationMarks } from '../src/game/xiangqiNotation';

test('notation marks round-trip file i and rank ten with native coordinate identity', () => {
  const parsed = notationAnnotations(['Position [%csl Gi10][%csl Ra10] [%cal Bh10g8,Yi10i9]']);
  assert.deepEqual(parsed.comments, ['Position']);
  assert.deepEqual(parsed.marks, [
    { from: 'i10', to: undefined, brush: 'green' },
    { from: 'a10', to: undefined, brush: 'red' },
    { from: 'h10', to: 'g8', brush: 'blue' },
    { from: 'i10', to: 'i9', brush: 'yellow' },
  ]);
  const serialized = notationMarks(parsed.marks);
  assert.ok(!serialized.includes(':'));
  assert.deepEqual(notationAnnotations([serialized]).marks, parsed.marks);
});

test('invalid supported annotation payloads fail explicitly, while unknown text stays safe data', () => {
  for (const input of ['[%cal Gh10z8]', '[%cal Gh0i1]', '[%csl Gz9]', '[%csl Ra:]'])
    assert.throws(() => notationAnnotations([input]), /Invalid Xiangqi annotation/);
  assert.deepEqual(notationAnnotations(['Keep <svg onload=alert(1)> [%unknown value]']), {
    comments: ['Keep <svg onload=alert(1)> [%unknown value]'],
    marks: [],
  });
});
