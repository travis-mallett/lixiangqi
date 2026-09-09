import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyCounterSnapshot } from '../src/counterSnapshot';

test('counter snapshots replace occupancy atomically', () => {
  const data = { counters: { members: 1, rounds: 2 }, poolCounts: { blitz: 9, stale: 4 } } as any;
  applyCounterSnapshot(data, { members: 3, rounds: 5, poolCounts: { blitz: 7 } });
  assert.deepEqual(data.counters, { members: 3, rounds: 5 });
  assert.deepEqual(data.poolCounts, { blitz: 7 });
});
