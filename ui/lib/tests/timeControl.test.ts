import assert from 'node:assert/strict';
import { test } from 'node:test';

import { poolId } from '../src/setup/timeControl';

test('homepage move-time rooms get stable, distinct pool IDs', () => {
  assert.equal(poolId('15+0', { seconds: 90, first: { moves: 3, seconds: 30 } }), '15+0-m90-30x3');
  assert.equal(poolId('5+0', { seconds: 60, first: { moves: 3, seconds: 30 } }), '5+0-m60-30x3');
  assert.equal(poolId('10+0', { seconds: 60, first: { moves: 3, seconds: 30 } }), '10+0-m60-30x3');
  assert.equal(poolId('20+0', { seconds: 60, first: { moves: 3, seconds: 30 } }), '20+0-m60-30x3');
});

test('ordinary quick-pair rooms retain their legacy clock IDs', () => {
  assert.equal(poolId('15+10'), '15+10');
});
