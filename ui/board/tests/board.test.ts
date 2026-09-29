import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  createBoard,
  boardPresentation,
  boardDefinition,
  positionFromFen,
  recordedPosition,
  standardXiangqi,
  type BoardView,
  type BoardPosition,
  type BoardDefinition,
  type BoardPurpose,
} from '../src';

const initial = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
const boards: BoardView[] = [];
afterEach(() => {
  for (const board of boards.splice(0)) {
    board.destroy();
    board.element.remove();
  }
});

test('redraw and disposal release resize observers', () => {
  let active = 0;
  class Observer {
    live = false;
    observe() {
      if (!this.live) {
        this.live = true;
        active++;
      }
    }
    disconnect() {
      if (this.live) {
        this.live = false;
        active--;
      }
    }
  }
  const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const windowDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', { value: Observer, configurable: true });
  Object.defineProperty(window, 'ResizeObserver', { value: Observer, configurable: true });
  try {
    const board = mount();
    assert.equal(active, 1);
    board.redraw();
    board.redraw();
    board.setPresentation({ ...board.getPresentation(), perspective: 'black' });
    assert.equal(active, 1);
    board.destroy();
    assert.equal(active, 0);
  } finally {
    if (globalDescriptor) Object.defineProperty(globalThis, 'ResizeObserver', globalDescriptor);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    if (windowDescriptor) Object.defineProperty(window, 'ResizeObserver', windowDescriptor);
    else Reflect.deleteProperty(window, 'ResizeObserver');
  }
});

function mount(
  purpose: BoardPurpose = 'interactive',
  position = positionFromFen(initial, standardXiangqi),
  definition: BoardDefinition = standardXiangqi,
  sound = () => {},
) {
  const element = document.createElement('div');
  document.body.append(element);
  const board = createBoard(element, {
    definition,
    position,
    presentation: boardPresentation(purpose, definition.participants[0]),
    interaction: { mode: 'display' },
    services: { assetUrl: path => `/assets/${path}`, sound },
  });
  boards.push(board);
  return board;
}

test('a rectangular position preserves rank ten and snapshots cannot mutate board state', () => {
  const board = mount();
  assert.deepEqual(board.position().pieces.get('a10'), { face: 'up', participant: 'black', role: 'chariot' });
  assert.equal(board.element.querySelectorAll('cg-board > piece').length, 32);
  const snapshot = board.position();
  (snapshot.pieces as Map<string, unknown>).clear();
  assert.equal(board.position().pieces.size, 32);
  const next = recordedPosition(board.position(), 'a4a5', 'black');
  board.setPresentation({ ...board.getPresentation(), motion: { duration: 0 } });
  board.display(next, { kind: 'forward' });
  assert.equal(board.position().pieces.has('a4'), false);
  assert.deepEqual(board.position().lastMove, ['a4', 'a5']);
});

test('feedback belongs to one board, is independent from audio, and acknowledgments do not repeat it', () => {
  let sounds = 0;
  const primary = mount('interactive', undefined, undefined, () => sounds++);
  const preview = mount('preview');
  primary.presentTransition({ kind: 'forward', id: 'move-1', effects: ['capture', 'check'] });
  assert.equal(sounds, 1);
  assert.equal(primary.element.querySelectorAll('.xiangqi-board-animation--check').length, 1);
  assert.equal(preview.element.querySelectorAll('.xiangqi-board-animation').length, 0);
  primary.presentTransition({ kind: 'confirmation', id: 'move-1', effects: ['check'] });
  primary.presentTransition({ kind: 'forward', id: 'move-1', effects: ['check'] });
  assert.equal(sounds, 1);
  primary.setPresentation({ ...primary.getPresentation(), feedback: { audio: false, effects: ['capture'] } });
  primary.presentTransition({ kind: 'forward', id: 'move-2', effects: ['capture'] });
  assert.equal(sounds, 1);
  assert.ok(primary.element.querySelector('.xiangqi-board-animation--capture'));
  primary.display(primary.position(), { kind: 'jump' });
  assert.equal(primary.element.querySelector('.xiangqi-board-animation'), null);
});

test('thumbnails stay quiet during playback and destroy releases registered playback resources', () => {
  let sounds = 0,
    cleanups = 0;
  const board = mount('thumbnail', undefined, undefined, () => sounds++);
  board.presentTransition({ kind: 'forward', effects: ['capture', 'checkmate'] });
  assert.equal(sounds, 0);
  assert.equal(board.element.querySelector('.xiangqi-board-animation'), null);
  board.onDestroy(() => cleanups++);
  board.destroy();
  board.destroy();
  assert.equal(cleanups, 1);
});

test('a cell board uses the same renderer and concealed pieces never gain a role', () => {
  const definition: BoardDefinition = {
    ...standardXiangqi,
    id: 'test-cell-board',
    geometry: { id: 'test-4x8', columns: 4, rows: 8, placement: 'cells' },
    coordinates: 'algebraic',
  };
  const position: BoardPosition = {
    active: 'red',
    pieces: new Map([['d8', { face: 'down', back: 'wood', participant: 'black' }]]),
  };
  const board = mount('editor', position, definition);
  assert.deepEqual(board.position().pieces.get('d8'), { face: 'down', back: 'wood', participant: 'black' });
  assert.equal(board.element.dataset.boardPlacement, 'cells');
  assert.equal(board.element.style.getPropertyValue('--board-columns'), '4');
  board.setInteraction({ mode: 'edit', onChange: () => {} });
  board.place('d8', { face: 'up', role: 'horse', participant: 'black' });
  assert.deepEqual(board.position().pieces.get('d8'), { face: 'up', role: 'horse', participant: 'black' });
});

test('invalid definitions and positions fail before they can silently display another game', () => {
  assert.throws(() => boardDefinition('banqi'), /Unsupported board/);
  assert.throws(() => positionFromFen('8/8/8/8/8/8/8/8 w', standardXiangqi), /Invalid board position/);
  assert.throws(() => positionFromFen('9/9/9/9/9/9/9/9/9/8 w', standardXiangqi), /Invalid board width/);
  const board = mount();
  assert.throws(() => board.place('a1'), /edit mode/);
  assert.throws(() => board.display({ active: 'green', pieces: new Map() }), /Unknown participant/);
  assert.equal(board.position().pieces.size, 32);
});

test('a preview can become interactive and a pending move locks input without restoring the old position', async () => {
  const board = mount('preview');
  let moves = 0;
  board.setInteraction({
    mode: 'play',
    participant: 'red',
    input: 'click',
    showDestinations: true,
    destinations: new Map([['a4', ['a5']]]),
    onMove: move => {
      assert.deepEqual([move.from, move.to], ['a4', 'a5']);
      moves++;
      board.setInteraction({ mode: 'display' });
    },
  });
  board.select('a4');
  board.select('a5');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(moves, 1);
  assert.equal(board.position().pieces.has('a5'), true);
  assert.equal(board.position().active, 'black');
  board.select('a5');
  board.select('a6');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(moves, 1);
  assert.equal(board.position().pieces.has('a5'), true);
});

test('server confirmation can announce check without replaying the optimistic move sound', () => {
  const cues: unknown[] = [];
  const element = document.createElement('div');
  document.body.append(element);
  const board = createBoard(element, {
    definition: standardXiangqi,
    position: positionFromFen(initial, standardXiangqi),
    presentation: boardPresentation('interactive', 'red'),
    interaction: { mode: 'display' },
    services: { assetUrl: path => path, sound: cue => cues.push(cue) },
  });
  boards.push(board);
  board.presentTransition({ kind: 'forward', id: 'ply-1', effects: [] });
  board.presentTransition({ kind: 'confirmation', id: 'ply-1', effects: ['check'] });
  board.presentTransition({ kind: 'confirmation', id: 'ply-1', effects: ['check'] });
  assert.deepEqual(cues, [
    { move: true, effects: [] },
    { move: false, effects: ['check'] },
  ]);
  assert.equal(element.querySelectorAll('.xiangqi-board-animation').length, 1);
});

test('queued premoves use canonical coordinates and execute only after authoritative destinations arrive', async () => {
  const board = mount('interactive', { ...positionFromFen(initial, standardXiangqi), active: 'black' });
  const moves: string[] = [];
  const play = {
    mode: 'play' as const,
    participant: 'red',
    input: 'click' as const,
    showDestinations: true,
    destinations: new Map<string, string[]>(),
    onMove: ({ from, to }: { from: string; to: string }) => moves.push(from + to),
    premove: { destinations: () => ['a5'] },
  };
  board.setPresentation({ ...board.getPresentation(), motion: { duration: 0 } });
  board.setInteraction(play);
  board.select('a4');
  board.select('a5');
  assert.equal(board.position().pieces.has('a4'), true);
  assert.equal(board.playPremove(), false);
  board.select('a4');
  board.select('a5');
  board.display({ ...board.position(), active: 'red' }, { kind: 'confirmation' });
  board.setInteraction({ ...play, destinations: new Map([['a4', ['a5']]]) });
  assert.equal(board.playPremove(), true);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(moves, ['a4a5']);
  assert.equal(board.position().pieces.has('a5'), true);
});
