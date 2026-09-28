import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calendar, metric, observed, type Report, type Row } from '../src/model';

const row: Row = {
  visitors: 3,
  visitorsLower: 3,
  visitorsUpper: 3,
  sessions: 5,
  participants: 3,
  counts: {
    page: 10,
    visibleMs: 60000,
    engagedMs: 30000,
    musicEnabledMs: 15000,
    visit_closed: 4,
    visit_closed_durationMs: 120000,
    quickExit: 1,
  },
};
test('ratios use their intended denominators', () => {
  assert.equal(metric(row, 'musicShare'), 50);
  assert.equal(metric(row, 'engagement'), 50);
  assert.equal(metric(row, 'quickExit'), 25);
  assert.equal(metric(row, 'meanVisit'), 30000);
  assert.equal(metric({ ...row, counts: {} }, 'musicShare'), 0);
  assert.equal(observed({ ...row, counts: {} }, 'musicShare'), false);
  assert.equal(observed(row, 'waitP50'), false);
  assert.equal(observed({ ...row, counts: { engagedMs: 100, musicEnabledMs: 0 } }, 'musicShare'), true);
});
test('calendar fills zero buckets without interpolating measurements across leap day', () => {
  const report = {
    from: '2024-02-28T00:00:00Z',
    until: '2024-03-02T00:00:00Z',
    grain: 'day',
    series: [{ ...row, at: '2024-02-28T00:00:00Z' }],
  } as Report;
  const rows = calendar(report);
  assert.deepEqual(
    rows.map(r => r.at?.slice(0, 10)),
    ['2024-02-28', '2024-02-29', '2024-03-01'],
  );
  assert.deepEqual(
    rows.map(r => r.visitors),
    [3, 0, 0],
  );
});
