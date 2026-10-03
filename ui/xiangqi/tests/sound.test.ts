import assert from 'node:assert/strict';
import test from 'node:test';

import type { RulesState } from 'lib/tree/native';

import { xiangqiMoveSound } from '../src/sound';

test('stalemate and checkmate use identical mate cues; draws and adjudicated losses do not', () => {
  const state: RulesState = {
    fen: '',
    ply: 1,
    turn: 'black',
    legalMoves: [],
    check: false,
    gameResult: '1-0',
    immediateEnd: { ended: true, result: 1 },
  };
  assert.equal(xiangqiMoveSound(state).mate, true);
  for (const termination of ['checkmate', 'stalemate'])
    assert.equal(xiangqiMoveSound({ ...state, termination }).mate, true);
  for (const termination of ['forced-variation', 'no-capture', 'mutual-check'])
    assert.equal(xiangqiMoveSound({ ...state, check: true, termination }).mate, false);
  assert.equal(xiangqiMoveSound({ ...state, check: true, gameResult: '1/2-1/2' }).mate, false);
  assert.equal(xiangqiMoveSound({ ...state, legalMoves: ['a1a2'], check: true }).mate, false);
});
