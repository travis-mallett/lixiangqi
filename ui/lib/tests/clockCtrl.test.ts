import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ClockCtrl } from '../src/game/clock/clockCtrl';

const clock = () =>
  new ClockCtrl(
    {
      initial: 300,
      increment: 3,
      moretime: 15,
      running: true,
      white: 300,
      black: 300,
      moveTime: 30,
    },
    { clockTenths: 1, clockBar: false },
    undefined,
    {
      onFlag() {},
      bothPlayersHavePlayed: () => true,
      hasGoneBerserk: () => false,
    },
  );

test('bank and per-move time count down independently from the same turn timer', () => {
  const ctrl = clock();
  const now = performance.now();
  ctrl.times.activeColor = 'white';
  ctrl.times.lastUpdate = now - 12000;

  assert.equal(ctrl.millisOf('white', now), 288000);
  assert.equal(ctrl.moveTimeMillis(now), 18000);
  assert.equal(ctrl.millisOf('black', now), 300000);
});

test('stopping a move subtracts elapsed time only from the bank', () => {
  const ctrl = clock();
  const now = performance.now();
  ctrl.times.activeColor = 'white';
  ctrl.times.lastUpdate = now - 12000;

  const elapsed = ctrl.stopClock();

  assert.ok(elapsed !== undefined && elapsed >= 12000);
  assert.ok(ctrl.times.white <= 288000);
  assert.equal(ctrl.times.moveTime, undefined);
  assert.equal(ctrl.times.activeColor, undefined);
});
