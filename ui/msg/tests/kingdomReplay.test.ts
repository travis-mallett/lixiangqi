import { mountViewer } from '@lixiangqi/viewer';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Rules } from 'threeKingdoms';

import type { BoardFrame } from '../src/boardContent';
import { kingdomReplay } from '../src/kingdomReplay';

test('chat replay renders the three armies, starts on a marked green turn and navigates a draw', async () => {
  const rules: Rules = (
    await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href)
  ).ThreeKingdoms;
  const initial = rules.initial();
  const action = rules.inspect(initial).moves[0];
  const next = rules.event(initial, 'red', action);
  const last = rules.event(next, 'green', 'draw');
  const frames: BoardFrame[] = [initial, next, last].map((fen, ply) => ({
    fen,
    ply,
    turn: rules.inspect(fen).turn,
    check: false,
    capture: false,
    checkmate: false,
    move: [undefined, action, 'draw'][ply],
    shapes: ply === 1 ? [{ orig: 'wu:4:0', dest: 'shu:4:0', brush: 'red' }] : [],
  }));
  const root = kingdomReplay({ frames, orientation: 'red', start: 1 }, rules);
  globalThis.AbortController = window.AbortController;
  window.matchMedia = globalThis.matchMedia;
  const viewer = await mountViewer(
    document.createElement('div'),
    { root },
    {
      initialPly: 1,
      inheritAppearance: true,
      showMoves: false,
      services: { assetUrl: path => path },
    },
  );
  try {
    assert.equal(viewer.position().position.board, 'threeKingdoms');
    assert.equal(viewer.position().position.active, 'green');
    assert.equal(viewer.position().marks[0].to, 'shu:4:0');
    viewer.navigate('last');
    assert.equal(viewer.position().move, 'draw');
    viewer.navigate('first');
    assert.equal(viewer.position(), root);
  } finally {
    viewer.destroy();
  }
});
