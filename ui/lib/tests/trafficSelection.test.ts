import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addSelectionTime,
  finishSelection,
  readSelections,
  type SelectionEpisodes,
} from '../src/traffic/selection';

test('new catalog options accumulate board use separately from foreground use and survive reload', () => {
  const episodes: SelectionEpisodes = {};
  const choices = { board: 'future-board', pieces: 'future-pieces', music: 'future-track' };
  addSelectionTime(episodes, choices, { boardMs: 1000, engagedMs: 5000 });
  const restored: SelectionEpisodes = JSON.parse(JSON.stringify(episodes));
  addSelectionTime(restored, choices, { boardMs: 2000, engagedMs: 6000 });
  assert.equal(finishSelection(restored, 'board', 'future-board', 'another-board'), 3000);
  assert.equal(finishSelection(restored, 'music', 'future-track', 'another-track'), 11000);
  assert.equal(restored.board.usedMs, 0);
  assert.equal(restored.pieces.usedMs, 3000);
});

test('an unobserved previous selection is missing evidence, not a measured zero', () => {
  const episodes: SelectionEpisodes = {};
  assert.equal(finishSelection(episodes, 'board', 'old', 'new'), undefined);
  addSelectionTime(episodes, { board: 'new' }, {});
  assert.equal(finishSelection(episodes, 'board', 'new', 'next'), 0);
});

test('malformed browser storage cannot break collection or inject invalid durations', () => {
  for (const value of [null, 42, 'invalid', [], { board: null }, { board: { value: 'new', usedMs: '5' } }])
    assert.deepEqual(readSelections(value), {});
  assert.deepEqual(readSelections({ board: { value: 'new', usedMs: 5 } }), {
    board: { value: 'new', usedMs: 5 },
  });
});
