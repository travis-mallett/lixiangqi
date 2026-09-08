import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { XIANGQI_START_FEN } from '../src/game/xiangqi';

const sent: unknown[][] = [];
mock.module(new URL('../src/socket.ts', import.meta.url).href, {
  namedExports: { wsSend: (...args: unknown[]) => sent.push(args) },
});
const { initMiniGames, initMiniGame, getChessground, updateMiniGame } = await import('../src/view/miniBoard');
const { pubsub } = await import('../src/pubsub');
// Load the same small DOM library shipped with the page.
const cash = await import('../../../public/javascripts/vendor/cash.min.js');
Object.assign(globalThis, { $: cash.default });

const boards: HTMLElement[] = [];
afterEach(() => {
  for (const node of boards.splice(0)) {
    getChessground(node.querySelector('.cg-wrap')!)?.destroy();
    node.remove();
  }
  sent.length = 0;
});

const movedFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1';

function mini(): HTMLElement {
  const node = document.createElement('a');
  node.className = 'mini-game mini-game--init';
  node.setAttribute('data-state', `${XIANGQI_START_FEN},white,`);
  node.innerHTML = '<span class="cg-wrap"></span>';
  document.body.append(node);
  boards.push(node);
  return node;
}

test('live mini-games render pieces, subscribe, and apply incoming moves', async () => {
  const node = mini();
  node.setAttribute('data-live', 'tvgame01');
  initMiniGames();
  pubsub.complete('socket.hasConnected');
  await Promise.resolve();
  assert.deepEqual(sent, [['startWatching', 'tvgame01']]);
  const ground = getChessground(node.querySelector('.cg-wrap')!);
  assert.equal(node.querySelectorAll('cg-board piece').length, 32);
  assert.ok(ground.state.animation);
  ground.set({ animation: { enabled: false } });
  updateMiniGame(node, { fen: movedFen, lm: 'a4a5' });
  assert.equal(ground.state.boardState.pieces.has('a4'), false);
  assert.equal(ground.state.boardState.pieces.get('a5')?.role, 'p-piece');
  assert.deepEqual(ground.state.lastMove, ['a4', 'a5']);
});

test('finished mini-games start at the initial position and replay recorded timing', async () => {
  const node = mini();
  node.setAttribute('data-state', `${movedFen},white,a4a5`);
  node.setAttribute('data-replay-initial-fen', XIANGQI_START_FEN);
  node.setAttribute('data-replay-moves', 'a4a5');
  node.setAttribute('data-replay-animation', '0');
  node.setAttribute(
    'data-recorded-clock',
    JSON.stringify({
      startPly: 0,
      positions: [
        { white: 3000, black: 3000 },
        { white: 2990, black: 3000 },
      ],
      delays: [10],
    }),
  );
  initMiniGame(node);
  const ground = getChessground(node.querySelector('.cg-wrap')!);
  assert.equal(ground.state.boardState.pieces.has('a4'), true);
  assert.equal(node.querySelectorAll('cg-board piece').length, 32);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(ground.state.boardState.pieces.has('a4'), false);
  assert.equal(ground.state.boardState.pieces.get('a5')?.role, 'p-piece');
});
