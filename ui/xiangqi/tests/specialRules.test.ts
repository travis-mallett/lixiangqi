import assert from 'node:assert/strict';
import test from 'node:test';

import { SpecialRulesPlayback, type ExamplePlayback } from '../src/specialRulesPlayback.ts';

const response = (acceptedPly: number, rejected = false): ExamplePlayback => ({
  ruleset: 'tiantian-v1',
  acceptedPly,
  state: {
    fen: 'server position',
    ply: acceptedPly,
    turn: 'red',
    legalMoves: [],
    check: false,
    gameResult: '*',
  },
  script: [],
  rejected: rejected ? { ply: 13, move: 'f8e8', error: 'Must vary: perpetual-check' } : null,
});

test('rejected attempt stays outside played history; rewinding clears it through the server', async () => {
  const requested: number[] = [];
  const playback = new SpecialRulesPlayback(
    async ply => {
      requested.push(ply);
      return response(Math.min(ply, 12), ply === 13);
    },
    () => {},
  );
  await playback.go(13);
  assert.equal(playback.data?.acceptedPly, 12);
  assert.equal(playback.previous(), 12);
  await playback.go(playback.previous());
  assert.equal(playback.data?.rejected, null);
  assert.equal(playback.previous(), 11);
  assert.deepEqual(requested, [13, 12]);
});

test('the player displays unexpected acceptance instead of enforcing the fixture expectation', async () => {
  const playback = new SpecialRulesPlayback(
    async ply => response(ply),
    () => {},
  );
  await playback.go(13);
  assert.equal(playback.data?.acceptedPly, 13);
  assert.equal(playback.data?.rejected, null);
});

test('overlapping navigation is serialized and failed requests preserve the last state for retry', async () => {
  let resolve!: (data: ExamplePlayback) => void;
  let requests = 0;
  const playback = new SpecialRulesPlayback(
    () => {
      requests++;
      return new Promise(r => {
        resolve = r;
      });
    },
    () => {},
  );
  const initial = playback.go(0);
  await playback.go(13);
  assert.equal(requests, 1);
  resolve(response(0));
  await initial;
  assert.equal(playback.pending, false);

  let fail = false;
  const retry = new SpecialRulesPlayback(
    async ply => {
      if (fail) throw new Error('offline');
      return response(ply);
    },
    () => {},
  );
  await retry.go(5);
  fail = true;
  await retry.go(6);
  assert.equal(retry.data?.acceptedPly, 5);
  assert.equal(retry.error, 'offline');
  assert.equal(retry.pending, false);
  fail = false;
  await retry.go(6);
  assert.equal(retry.data?.acceptedPly, 6);
  assert.equal(retry.error, undefined);
});
