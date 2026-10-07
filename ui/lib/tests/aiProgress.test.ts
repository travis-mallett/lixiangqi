import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guestAiProgress, highestBeatenAiLevel, nextAiLevel, recordGuestAiWin } from '../src/game/aiProgress';
import type { GameData } from '../src/game/interfaces';

const game = (): GameData =>
  ({
    game: { source: 'ai', variant: { key: 'standard' }, status: { id: 30 }, winner: 'white' },
    player: { color: 'white' },
    opponent: { ai: 98 },
  }) as GameData;

test('account progress uses the highest actual win, ignoring losses and draws', () => {
  const completed = highestBeatenAiLevel([
    { level: 720, mine: { wins: 0 } },
    { level: 98, mine: { wins: 1 } },
    { level: 39, mine: { wins: 5 } },
  ]);
  assert.equal(completed, 98);
  assert.equal(nextAiLevel(completed), 99);
  assert.equal(nextAiLevel(0), 1);
  assert.equal(nextAiLevel(720), 720);
});

test('guest wins persist skip progress and repeated or lower wins never reduce it', () => {
  localStorage.clear();
  assert.equal(guestAiProgress(), 0);
  const data = game();
  recordGuestAiWin(data);
  recordGuestAiWin(data);
  data.opponent.ai = 1;
  recordGuestAiWin(data);
  assert.equal(guestAiProgress(), 98);
  data.opponent.ai = 720;
  recordGuestAiWin(data);
  assert.equal(guestAiProgress(), 720);
});

test('spectating, signed-in games, custom positions, unfinished games and non-wins do not advance guest progress', () => {
  const cases = [
    (d: GameData) => {
      d.player.spectator = true;
    },
    (d: GameData) => {
      d.player.user = { id: 'someone' } as GameData['player']['user'];
    },
    (d: GameData) => {
      d.game.variant.key = 'fromPosition';
    },
    (d: GameData) => {
      d.game.initialFen = 'custom position';
    },
    (d: GameData) => {
      d.game.status.id = 20;
    },
    (d: GameData) => {
      d.game.status.id = 25;
    },
    (d: GameData) => {
      d.game.winner = 'black';
    },
    (d: GameData) => {
      d.game.winner = undefined;
    },
    (d: GameData) => {
      d.game.source = 'local';
    },
  ];
  for (const change of cases) {
    localStorage.clear();
    const data = game();
    change(data);
    recordGuestAiWin(data);
    assert.equal(guestAiProgress(), 0);
  }
});
