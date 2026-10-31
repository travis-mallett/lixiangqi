import assert from 'node:assert/strict';
import { test } from 'node:test';

import { drawable, resignable, type GameData } from '../src/game';

for (const variant of ['xiangqi', 'jieqi']) {
  for (const ai of [undefined, 1]) {
    test(variant + ' shares resignation and draw eligibility (AI: ' + ai + ')', () => {
      const data = {
        game: { variant: { key: variant }, status: { id: 20 }, source: 'friend', turns: 0, player: 'white' },
        player: { color: 'white' },
        opponent: { color: 'black', ai },
      } as GameData;
      assert.equal(resignable(data), false);
      assert.equal(drawable(data), false);
      for (const turns of [2, 3, 13, 14, 15]) {
        data.game.turns = turns;
        for (const turn of ['white', 'black'] as const) {
          data.game.player = turn;
          assert.equal(resignable(data), true);
          assert.equal(drawable(data), !ai);
        }
      }
      data.game.status.id = 31;
      assert.equal(resignable(data), false);
      assert.equal(drawable(data), false);
    });
  }
}
