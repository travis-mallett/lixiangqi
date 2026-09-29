import assert from 'node:assert/strict';
import { test } from 'node:test';

import { notationAnnotations, notationMarks } from '../src/game/xiangqiNotation';

test('notation marks round-trip file i and rank ten without exposing study square encoding', () => {
  const parsed = notationAnnotations(['Position [%csl Gi10][%csl Ra:] [%cal Bh10g8,Yi:i9]']);
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

test('untrusted and invalid annotation payloads cannot supply artwork or invalid locations', () => {
  const parsed = notationAnnotations(['Keep <svg onload=alert(1)> [%cal Gh10z8,Gh0i1] [%csl Gz9]']);
  assert.deepEqual(parsed.marks, []);
  assert.deepEqual(parsed.comments, ['Keep <svg onload=alert(1)>']);
});
