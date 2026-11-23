import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ClockCtrl } from '../src/game/clock/clockCtrl';
import { formatClockTime } from '../src/game/clock/clockView';

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

test('only the active side expires at the first exhausted limit', () => {
  const ctrl = clock();
  ctrl.times.activeColor = 'black';
  ctrl.times.lastUpdate = 200;
  ctrl.times.moveTime = 1000;
  assert.equal(ctrl.expired('black', 1199), false);
  assert.equal(ctrl.expired('black', 1200), true);
  assert.equal(ctrl.expired('white', 1200), false);
  ctrl.times.black = 100;
  assert.equal(ctrl.expired('black', 300), true);
  ctrl.times.activeColor = undefined;
  assert.equal(ctrl.expired('black', 300), false);
});

test('running clock keeps its last visible unit until it reaches zero', () => {
  const digits = (time: number, tenths: boolean) =>
    formatClockTime(time, tenths, true).replace(/<[^>]+>/g, '');
  assert.equal(digits(1, false), '00:01');
  assert.equal(digits(1, true), '00:00.1');
  assert.equal(digits(0, true), '00:00.0');
  assert.equal(digits(0, false), '00:00');
});
