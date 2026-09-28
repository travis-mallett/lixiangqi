import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AttentionClock, type AttentionState } from '../src/traffic/clock';

const active: AttentionState = {
  visible: true,
  ownsAttention: true,
  board: true,
  solving: true,
  musicEnabled: true,
  effectsEnabled: true,
  musicPlaying: false,
};

test('visible reading and actual engaged/board/solving/audio time remain separate', () => {
  const clock = new AttentionClock(0);
  assert.deepEqual(clock.read(5000, active), {
    visibleMs: 5000,
    engagedMs: 5000,
    boardMs: 5000,
    solvingMs: 5000,
    musicEnabledMs: 5000,
    effectsEnabledMs: 5000,
    musicPlayingMs: 0,
  });
  for (let at = 10000; at <= 120000; at += 5000) clock.read(at, active);
  assert.equal(clock.read(125000, active).engagedMs, 0);
  assert.equal(clock.read(130000, active).visibleMs, 5000);
  clock.interact(130000);
  assert.equal(clock.read(135000, active).engagedMs, 5000);
});

test('hidden tabs, inactive tab ownership and sleeping devices cannot inflate engagement', () => {
  const clock = new AttentionClock(0);
  assert.deepEqual(clock.read(5000, { ...active, visible: false }), {});
  const inactive = clock.read(10000, { ...active, ownsAttention: false });
  assert.equal(inactive.visibleMs, 5000);
  assert.equal(inactive.engagedMs, 0);
  assert.deepEqual(clock.read(1000000, active), {});
});

test('a boundary bills the preceding state and splits precisely at the idle cutoff', () => {
  const clock = new AttentionClock(0);
  for (let at = 5000; at <= 115000; at += 5000) clock.read(at, active);
  assert.equal(clock.read(123000, active).engagedMs, 5000);
  clock.interact(123000);
  assert.equal(clock.read(124000, { ...active, solving: false }).solvingMs, 0);
});
