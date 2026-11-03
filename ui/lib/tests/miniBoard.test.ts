import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { XIANGQI_START_FEN } from '../src/game/xiangqi';

const sent: unknown[][] = [];
mock.module(new URL('../src/socket.ts', import.meta.url).href, {
  namedExports: { wsSend: (...args: unknown[]) => sent.push(args) },
});
const { initMiniBoard, initMiniGames, initMiniGame, getBoard, updateMiniGame } =
  await import('../src/view/miniBoard');
const { pubsub } = await import('../src/pubsub');
// Load the same small DOM library shipped with the page.
const cash = await import('../../../public/javascripts/vendor/cash.min.js');
Object.assign(globalThis, { $: cash.default });

const boards: HTMLElement[] = [];
afterEach(() => {
  for (const node of boards.splice(0)) {
    getBoard(node.querySelector('.cg-wrap')!)?.destroy();
    node.remove();
  }
  sent.length = 0;
});

const movedFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1';

for (const [fen, perspective, from, to, participant] of [
  [
    '2bak2nr/4a4/2c1b2c1/p3pCp1p/9/2p4R1/P3P1P1P/3A4C/1rN1K1n2/R2A2BN1 b - - 0 1',
    'black',
    'b2',
    'c2',
    'black',
  ],
  ['4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1', 'black', 'a3', 'e3', 'red'],
])
  test(`CAPTCHA mini-board can play ${participant}, independently of perspective`, async () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="cg-wrap mini-board"></div>';
    document.body.append(wrapper);
    boards.push(wrapper);
    const element = wrapper.querySelector<HTMLElement>('.cg-wrap')!;
    element.dataset.state = `${fen},${perspective},`;
    initMiniBoard(element);
    const board = getBoard(element)!;
    board.setPresentation({ ...board.getPresentation(), motion: { duration: 0 } });
    const position = board.position();
    assert.equal(position.active, participant);
    const moves: string[] = [];
    const enable = () =>
      board.setInteraction({
        mode: 'play',
        participant: position.active,
        input: 'both',
        destinations: new Map([[from, [to]]]),
        onMove: ({ from, to }) => moves.push(`${from} ${to}`),
      });
    enable();
    board.select(from);
    board.select(to);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(moves, [`${from} ${to}`]);
    board.display(position, { kind: 'correction' });
    enable();
    board.select(from);
    board.select(to);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(moves.length, 2);
  });

function mini(): HTMLElement {
  const node = document.createElement('a');
  node.className = 'mini-game mini-game--init';
  node.setAttribute('data-state', `${XIANGQI_START_FEN},white,`);
  node.innerHTML = '<span class="cg-wrap"></span>';
  document.body.append(node);
  boards.push(node);
  return node;
}

for (const [name, fen, boardId, count] of [
  ['Mini Xiangqi', 'rcnkncr/p1ppp1p/7/7/7/P1PPP1P/RCNKNCR w - - 0 1', 'minixiangqi', 24],
  ['Jieqi', 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w - - 0 1', 'xiangqi', 32],
] as const)
  test(`${name} TV embed renders without full-site globals`, () => {
    const node = mini();
    node.setAttribute('data-state', `${fen},white,`);
    const globals = globalThis as any;
    const saved = { site: globals.site, i18n: globals.i18n };
    delete globals.site;
    delete globals.i18n;
    try {
      initMiniGame(node, { assetUrl: path => `/assets/${path}` });
      const board = getBoard(node.querySelector('.cg-wrap')!)!;
      assert.equal(board.position().board, boardId);
      assert.equal(node.querySelectorAll('cg-board piece').length, count);
      updateMiniGame(node, { fen, lm: '' });
      assert.equal(board.position().pieces.size, count);
    } finally {
      Object.assign(globals, saved);
    }
  });

test('live mini-games render pieces, subscribe, and apply incoming moves', async () => {
  const node = mini();
  node.setAttribute('data-live', 'tvgame01');
  initMiniGames();
  pubsub.complete('socket.hasConnected');
  await Promise.resolve();
  assert.deepEqual(sent, [['startWatching', 'tvgame01']]);
  const ground = getBoard(node.querySelector('.cg-wrap')!);
  assert.equal(node.querySelectorAll('cg-board piece').length, 32);
  assert.ok(ground);
  ground.setPresentation({ ...ground.getPresentation(), motion: { duration: 0 } });
  assert.deepEqual(ground.getPresentation().feedback, { effects: [], audio: false });
  updateMiniGame(node, { fen: movedFen, lm: 'a4a5' });
  assert.equal(ground.position().pieces.has('a4'), false);
  assert.equal(ground.position().pieces.get('a5')?.role, 'soldier');
  assert.deepEqual(ground.position().lastMove, ['a4', 'a5']);
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
  const ground = getBoard(node.querySelector('.cg-wrap')!);
  assert.equal(ground!.position().pieces.has('a4'), true);
  assert.equal(node.querySelectorAll('cg-board piece').length, 32);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(ground!.position().pieces.has('a4'), false);
  assert.equal(ground!.position().pieces.get('a5')?.role, 'soldier');
});
