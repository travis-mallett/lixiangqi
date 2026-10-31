import assert from 'node:assert/strict';
import { test } from 'node:test';

import { afterMove, initialPlacement, mapToPlacement, placementToMap } from './board.mjs';
import { validateConfig } from './run.mjs';
import { scoresFor, verifyScores } from './scores.mjs';

test('rendered board conversion and captures preserve coordinates', () => {
  assert.equal(mapToPlacement(placementToMap(initialPlacement)), initialPlacement);
  const moved = placementToMap(afterMove(initialPlacement, 'h2h9'));
  assert.equal(moved.get('h9'), 'C');
  assert.equal(moved.has('h2'), false);
  assert.equal(moved.size, 31);
  assert.throws(() => afterMove(initialPlacement, 'a1a2'));
});

test('non-local execution requires explicit authorization and HTTPS', () => {
  const base = { enginePath: 'pikafish', emailTemplate: '{username}@example.org' };
  assert(validateConfig({ ...base, baseUrl: 'http://lixiangqi.localhost:9663' }, false).local);
  assert.throws(() => validateConfig({ ...base, baseUrl: 'https://lixiangqi.com' }, false));
  assert.throws(() => validateConfig({ ...base, baseUrl: 'http://lixiangqi.com' }, true));
  assert.throws(() => validateConfig({ ...base, baseUrl: 'https://example.org/private' }, true));
  assert.throws(() => validateConfig({ ...base, baseUrl: 'http://localhost:9663', headless: true }, false));
  assert.equal(validateConfig({ ...base, baseUrl: 'https://lixiangqi.com' }, true).local, false);
});

test('observed results reproduce streak, berserk and draw scoring', () => {
  const results = ['1-0', '1-0', '1-0', '½-½', '0-1', '½-½', '½-½'];
  const games = results.map((result, i) => ({
    gameId: String(i),
    result,
    players: { white: 'red', black: 'black' },
    moves: Array(i === 6 ? 18 : 40),
  }));
  assert.deepEqual(scoresFor(games, 'red', new Set(['2'])), [2, 2, 5, 2, 0, 0, 0]);
});

test('score audit rejects an omitted earlier game', () => {
  const manifest = {
    finishedAt: '2026-10-29T01:20:00Z',
    games: [
      {
        gameId: 'game0001',
        players: { white: 'red', black: 'black' },
        result: '1-0',
        moves: Array(40),
        startedAt: '2026-10-29T01:01:00Z',
        finishedAt: '2026-10-29T01:02:00Z',
      },
    ],
    standings: [{ username: 'red', sheet: [] }],
  };
  assert.throws(() => verifyScores(manifest, []), /Earlier game omitted/);
});
