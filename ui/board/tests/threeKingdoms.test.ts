import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createBoard, boardPresentation, threeKingdoms, type BoardView, type BoardPosition } from '../src';
import { boardImageSvg } from '../src/image';
import { graphPoint, rotateGraphPoint } from '../src/renderer/graphGeometry';

const boards: BoardView[] = [];
afterEach(() => {
  for (const board of boards.splice(0)) {
    board.destroy();
    board.element.remove();
  }
});

function mount(position: BoardPosition) {
  const element = document.createElement('div');
  document.body.append(element);
  const board = createBoard(element, {
    definition: threeKingdoms,
    position,
    presentation: { ...boardPresentation('interactive', 'red'), motion: { duration: 0 } },
    interaction: { mode: 'display' },
    services: { assetUrl: path => path },
  });
  boards.push(board);
  return board;
}
const position: BoardPosition = {
  board: 'threeKingdoms',
  active: 'red',
  pieces: new Map([
    ['wu:0:0', { face: 'up', participant: 'green', role: 'chariot', controller: 'red' }],
    ['wei:0:0', { face: 'up', participant: 'black', role: 'chariot', controller: null }],
  ]),
};

test('armies face into each territory from every seat, including conquered armies and exports', () => {
  const board = mount(position);
  const rotations: Record<string, number> = { red: 120, black: 0, green: 240 };
  for (const perspective of ['red', 'black', 'green']) {
    board.setPresentation(boardPresentation('interactive', perspective));
    for (const participant of ['red', 'black', 'green']) {
      for (const [territory, home] of [
        ['wei', 'black'],
        ['shu', 'red'],
        ['wu', 'green'],
      ]) {
        const square = `${territory}:4:2`;
        const next: BoardPosition = {
          active: 'red',
          pieces: new Map([[square, { face: 'up', participant, role: 'chariot', controller: 'red' }]]),
        };
        board.display(next);
        const angle = rotations[perspective] - rotations[home] + (participant === home ? 0 : 180);
        const node = board.element.querySelector<HTMLElement>(`[data-piece-location="${square}"]`)!;
        const actual = parseFloat(node.style.getPropertyValue('--board-face-rotation'));
        assert.ok(Math.abs(Math.sin(((actual - angle) * Math.PI) / 360)) < 1e-10);
        const svg = boardImageSvg({ definition: threeKingdoms, position: next, perspective }, path => path);
        const [x, y] = graphPoint(threeKingdoms.geometry, square, perspective);
        assert.ok(svg.includes(`transform="rotate(${actual} ${x} ${y})"`));
      }
    }
  }
});

test('pieces follow skewed files and turn to face the defender after crossing a river', () => {
  const piece = { face: 'up', participant: 'black', role: 'chariot' } as const;
  const angle = (square: string) => threeKingdoms.pieceRotation!(square, piece);
  // Wei's outer files lean 30 degrees either side of its vertical center file.
  for (let rank = 0; rank < 5; rank++) {
    assert.ok(Math.abs(angle(`wei:0:${rank}`) + 30) < 1e-10);
    assert.ok(Math.abs(angle(`wei:4:${rank}`)) < 1e-10);
    assert.ok(Math.abs(angle(`wei:8:${rank}`) - 30) < 1e-10);
  }
  assert.ok(Math.abs(angle('shu:4:4') - 60) < 1e-10);
  assert.ok(Math.abs(angle('wu:4:4') - 300) < 1e-10);
});

test('the graph renderer exposes all 135 locations and preserves army identity separately from ownership', () => {
  const board = mount(position);
  assert.equal(board.element.querySelectorAll('[data-location]').length, 135);
  const acquired = board.element.querySelector<HTMLElement>('[data-piece-location="wu:0:0"]')!;
  assert.equal(acquired.dataset.controller, 'red');
  assert.match(acquired.style.getPropertyValue('--xiangqi-piece-image'), /green-chariot/);
  assert.equal(
    board.element.querySelector<HTMLElement>('[data-location="wei:0:0"]')!.dataset.controller,
    'neutral',
  );
  const moves: string[] = [];
  board.setInteraction({
    mode: 'play',
    participant: 'red',
    input: 'both',
    showDestinations: true,
    destinations: new Map([
      ['wu:0:0', ['wu:0:1']],
      ['wei:0:0', ['wei:0:1']],
    ]),
    onMove: ({ from, to }) => moves.push(`${from}>${to}`),
  });
  assert.equal(board.allowsMove('wei:0:0', 'wei:0:1'), false);
  board.select('wu:0:0');
  board.select('wu:0:1');
  assert.deepEqual(moves, ['wu:0:0>wu:0:1']);
  assert.equal(board.position().pieces.get('wu:0:0')?.participant, 'green');
});

test('queued graph premoves use the shared indicator and clear when cancelled', () => {
  const board = mount({ ...position, active: 'black' });
  board.setInteraction({
    mode: 'play',
    participant: 'red',
    input: 'both',
    showDestinations: true,
    destinations: new Map(),
    premove: { destinations: () => ['wu:0:1'] },
    onMove: () => assert.fail('A queued premove must not submit a move'),
  });
  board.select('wu:0:0');
  board.select('wu:0:1');
  assert.deepEqual(
    [...board.element.querySelectorAll<HTMLElement>('.current-premove')].map(node => node.dataset.location),
    ['wu:0:0', 'wu:0:1'],
  );
  board.cancelPremove();
  assert.equal(board.element.querySelectorAll('.current-premove').length, 0);
});

test('hit testing and river feedback rotate with every seat without changing the artwork geometry', () => {
  const board = mount(position);
  const geometry = threeKingdoms.geometry;
  const surface = board.element.querySelector<HTMLElement>('.graph-board__surface')!;
  surface.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    width: geometry.width / 2,
    height: geometry.height / 2,
    bottom: 20 + geometry.height / 2,
    right: 10 + geometry.width / 2,
    toJSON() {},
  });
  for (const perspective of ['red', 'black', 'green']) {
    board.setPresentation(boardPresentation('interactive', perspective));
    for (const location of Object.keys(geometry.locations)) {
      const [x, y] = graphPoint(geometry, location, perspective);
      assert.equal(board.locationAt([10 + x / 2, 20 + y / 2]), location);
    }
    board.presentTransition({
      kind: 'forward',
      id: perspective,
      effects: ['capture'],
      effectTargets: { capture: ['green'] },
      effectRoutes: { capture: [['black', 'green']] },
    });
    const feedback = board.element.querySelector<HTMLElement>('.xiangqi-board-animation__image')!;
    const point = rotateGraphPoint(geometry, geometry.riverAnchors!['black:green'], perspective);
    assert.ok(Math.abs(parseFloat(feedback.style.left) - (point[0] * 100) / geometry.width) < 0.00001);
    assert.ok(Math.abs(parseFloat(feedback.style.top) - (point[1] * 100) / geometry.height) < 0.00001);
    assert.notEqual(feedback.style.left + feedback.style.top, '50%50%');
  }
  board.destroy();
  assert.equal(board.element.querySelectorAll('.xiangqi-board-animation, .graph-board__surface').length, 0);
});
