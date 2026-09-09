import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { playMoveNavigationSound } from '../src/game/replay/moveNavigationSound';

test('plays the caller cue forward and the base move cue backward', () => {
  const move = mock.fn();
  const forward = mock.fn();
  globalThis.site = { sound: { move } } as any;

  playMoveNavigationSound(0, 1, forward);
  assert.equal(forward.mock.callCount(), 1);
  assert.equal(move.mock.callCount(), 0);

  playMoveNavigationSound(1, 0, forward);
  assert.equal(forward.mock.callCount(), 1);
  assert.equal(move.mock.callCount(), 1);
  assert.deepEqual(move.mock.calls[0].arguments, []);
});

test('does not play for unchanged or multi-ply navigation', () => {
  const move = mock.fn();
  const forward = mock.fn();
  globalThis.site = { sound: { move } } as any;

  playMoveNavigationSound(3, 3, forward);
  playMoveNavigationSound(1, 3, forward);
  playMoveNavigationSound(3, 1, forward);

  assert.equal(forward.mock.callCount(), 0);
  assert.equal(move.mock.callCount(), 0);
});
