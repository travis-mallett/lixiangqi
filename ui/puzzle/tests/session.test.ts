import assert from 'node:assert/strict';
import { test } from 'node:test';

import PuzzleSession from '../src/session.ts';

test('session preserves the first result and rating change across practice', () => {
  const session = new PuzzleSession('mix', undefined, true);
  session.clear();
  session.complete('won', true);
  session.setRatingDiff('won', 21);
  session.complete('lost', false);
  session.setRatingDiff('lost', -7);
  session.complete('won', false);
  session.setRatingDiff('won', 0);
  session.complete('lost', true);
  session.setRatingDiff('lost', 10);
  assert.deepEqual(session.get().rounds, [
    { id: 'won', result: true, ratingDiff: 21 },
    { id: 'lost', result: false, ratingDiff: -7 },
  ]);
});

test('zero rating changes stay zero and an unrated result stays a result', () => {
  const session = new PuzzleSession('mix', undefined, true);
  session.clear();
  session.complete('hinted', true);
  session.setRatingDiff('hinted', 0);
  session.complete('hinted', false);
  session.setRatingDiff('hinted', -12);
  assert.deepEqual(session.get().rounds, [{ id: 'hinted', result: true, ratingDiff: 0 }]);
});
