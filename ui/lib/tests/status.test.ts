import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GameData } from '../src/game';
import status, { statusOf } from '../src/game/view/status';

for (const [variant, fen] of [
  ['xiangqi', '4k4/9/9/9/9/9/9/9/9/2BAKAB2 w - - 100 125'],
  ['jieqi', '4k4/9/9/9/9/9/9/9/9/2BAKAB2 w - - 100 125'],
  ['minixiangqi', '3k3/7/7/7/7/7/2BKB2 w - - 100 125'],
]) {
  test(`${variant} draw status uses authoritative adjudication without chess-board inference`, () => {
    document.documentElement.lang = 'en';
    const data = {
      game: {
        variant: { key: variant },
        fen,
        turns: 247,
        status: { name: 'draw' },
        termination: 'no-attacking-material',
      },
    } as GameData;
    assert.equal(status(data), 'Draw: neither side has attacking material.');
    data.game.termination = undefined;
    assert.equal(String(status(data)), 'site.draw');
  });
}

test('Xiangqi repetition, no-capture and move limits use their actual reasons', () => {
  document.documentElement.lang = 'en';
  assert.equal(
    statusOf({ status: 'draw', ply: 140, termination: 'no-capture' }),
    'Draw: 120 counted plies without a capture.',
  );
  assert.equal(
    statusOf({ status: 'draw', ply: 80, termination: 'repetition' }),
    'Draw: fivefold repetition.',
  );
  assert.equal(statusOf({ status: 'draw', ply: 400, termination: 'move-limit' }), 'Draw: 400 plies played.');
});

test('stalemate is a win and agreement remains a distinct draw', () => {
  assert.equal(
    statusOf({ status: 'mate', winner: 'white', ply: 40, termination: 'stalemate' }),
    'Win by stalemate. • site.whiteIsVictorious',
  );
  assert.equal(String(statusOf({ status: 'draw', ply: 40, drawOffers: [40] })), 'site.drawByMutualAgreement');
});
