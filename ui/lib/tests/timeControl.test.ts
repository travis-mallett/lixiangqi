import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prop, propWithEffect, withEffect } from '../src/common';
import { poolId, timeControlFromStoredValues } from '../src/setup/timeControl';

test('optional properties distinguish clearing from reading, including effects', () => {
  const changes: (number | undefined)[] = [];
  for (const property of [
    prop<number | undefined>(1),
    propWithEffect<number | undefined>(1, v => changes.push(v)),
  ]) {
    const wrapped = withEffect(property, v => changes.push(v));
    assert.equal(wrapped(), 1);
    wrapped(undefined);
    assert.equal(wrapped(), undefined);
    wrapped(2);
    assert.equal(wrapped(), 2);
  }
  assert.deepEqual(changes, [undefined, 2, undefined, undefined, 2, 2]);
});

test('disabling the per-move limit removes it from stored settings and presets', () => {
  let stored: unknown;
  const tc = timeControlFromStoredValues(
    prop('realTime'),
    ['realTime'],
    1,
    0,
    2,
    { seconds: 90 },
    () => {
      stored = tc.moveTime();
    },
    [],
  );
  tc.setMoveTimeEnabled(false);
  assert.equal(tc.moveTime(), undefined);
  assert.equal(stored, undefined);
  assert.equal(tc.valid(), true);
  tc.setMoveTimeEnabled(true);
  tc.selectPreset({ lim: 1, inc: 0 });
  assert.equal(tc.moveTime(), undefined);
});

test('homepage move-time rooms get stable, distinct pool IDs', () => {
  assert.equal(poolId('15+0', { seconds: 90, first: { moves: 3, seconds: 30 } }), '15+0-m90-30x3');
  assert.equal(poolId('5+0', { seconds: 60, first: { moves: 3, seconds: 30 } }), '5+0-m60-30x3');
  assert.equal(poolId('10+0', { seconds: 60, first: { moves: 3, seconds: 30 } }), '10+0-m60-30x3');
  assert.equal(poolId('20+0', { seconds: 60, first: { moves: 3, seconds: 30 } }), '20+0-m60-30x3');
});

test('ordinary quick-pair rooms retain their legacy clock IDs', () => {
  assert.equal(poolId('15+10'), '15+10');
});
