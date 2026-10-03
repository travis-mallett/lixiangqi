import assert from 'node:assert/strict';
import { test } from 'node:test';

import MotifCtrl from '../src/motif/motifCtrl';
import type { Settings } from '../src/settingsCtrl';

const position = { initialFen: 'root', moves: ['i10i9', 'a1a2'], ruleset: 'tiantian-v1' };
const result = {
  pins: [{ pinned: 'i9', pinner: 'i1', target: 'i10' }],
  undefended: [{ square: 'h10', materialLoss: 4, principalAttacker: 'h1' }],
  checkable: [{ general: 'e10', move: 'i9e9' }],
};

test('tactical overlays request native history and preserve rank-ten marks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify(result));
  });
  let redraws = 0;
  const ctrl = new MotifCtrl(
    { showPinnedPieces: true, showCheckableGeneral: true, showUndefendedPieces: true } as Settings,
    () => redraws++,
  );
  assert.deepEqual(ctrl.shapes(position), []);
  t.mock.timers.tick(180);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [position]);
  assert.equal(redraws, 1);
  assert.deepEqual(ctrl.shapes(position), [
    { from: 'i9', brush: 'paleRed' },
    { from: 'i1', to: 'i10', brush: 'paleRed' },
    { from: 'h10', brush: 'yellow' },
    { from: 'e10', brush: 'red' },
    { from: 'i9', to: 'e9', brush: 'paleRed' },
  ]);
  ctrl.shapes({ ...position, moves: ['a1a2', 'i10i9'] });
  t.mock.timers.tick(180);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, 'same final FEN with another history is a separate position');
  ctrl.destroy();
});
