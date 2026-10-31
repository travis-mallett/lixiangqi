import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { boardPresentation, createBoard, positionFromFen, standardXiangqi } from '../src';
import { makeRenderer, startDrag } from './support/renderer';

// Control WAAPI completion independently of redraws and server acknowledgments.
// Real browsers retain fill-forwards effects until their owner cancels them.
interface Effect {
  element: HTMLElement;
  frames: Keyframe[];
  duration: number;
  startTime?: number | null;
  pending: boolean;
  cancelled: boolean;
  finish(): void;
}
const effects: Effect[] = [];
const boards: ReturnType<typeof makeRenderer>[] = [];
const originalAnimate = window.Element.prototype.animate;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  window.Element.prototype.animate = function (frames, options) {
    let resolve!: () => void;
    const finished = new Promise<void>(done => (resolve = done));
    const effect: Effect = {
      element: this,
      frames: frames as Keyframe[],
      duration: (options as KeyframeAnimationOptions).duration as number,
      pending: true,
      cancelled: false,
      finish() {
        this.pending = false;
        resolve();
      },
    };
    effects.push(effect);
    return {
      finished,
      set startTime(value: number | null) {
        effect.startTime = value;
      },
      cancel() {
        effect.cancelled = true;
        effect.finish();
      },
    } as unknown as Animation;
  };
});

afterEach(async () => {
  for (const board of boards.splice(0)) {
    board.destroy();
    board.state.dom.elements.wrap.remove();
  }
  await tick();
  effects.length = 0;
  window.Element.prototype.animate = originalAnimate;
  mock.restoreAll();
});

const initial = '4k4/9/9/9/9/9/p8/X7X/9/4K4';
const revealed = '4k4/9/9/9/9/9/R8/8X/9/4K4';

function mount() {
  const element = document.createElement('div');
  document.body.append(element);
  const board = makeRenderer(element, {
    fen: initial,
    movableColor: 'white',
    legalMoves: ['a3a4', 'i3i4'],
    moveEvent: 2,
  });
  board.state.dom.bounds = Object.assign(
    () => ({ x: 0, y: 0, left: 0, top: 0, width: 900, height: 1000 }) as DOMRect,
    { clear() {} },
  );
  boards.push(board);
  return board;
}

async function phase() {
  for (const effect of effects.filter(effect => effect.pending)) effect.finish();
  await tick();
}

async function settle(board: ReturnType<typeof mount>) {
  for (let i = 0; i < 8; i++) await phase();
  board.state.dom.redrawNow();
  assert.equal(board.state.animation.current, undefined);
  assert.equal(board.state.dom.elements.board.querySelectorAll('.xiangqi-motion-piece, .fading').length, 0);
  assert.ok(effects.every(effect => effect.cancelled));
}

function reveal(board: ReturnType<typeof mount>) {
  board.set({ fen: revealed, lastMove: ['a3', 'a4'], turnColor: 'black' }, { animation: 'reveal' });
}

test('concealed-piece FEN round trips preserve both colors', () => {
  const board = mount();
  const fen = initial.replace('p8', 'x8');
  board.set({ fen, animation: { enabled: false } });
  assert.equal(board.getFen(), fen);
  board.set({ fen: board.getFen() });
  assert.equal(board.state.boardState.pieces.get('a3')?.color, 'white');
  assert.equal(board.state.boardState.pieces.get('a4')?.color, 'black');
});

test('remote reveal captures follow the measured reference timeline', async () => {
  let now = 0;
  mock.method(performance, 'now', () => now);
  const board = mount();
  reveal(board);
  const root = board.state.dom.elements.board;
  assert.equal(root.querySelectorAll('.jieqi-reveal-stack').length, 0);
  assert.ok(effects.some(effect => effect.element.classList.contains('fading')));
  assert.ok(
    effects.some(
      effect => effect.duration === 100 && effect.element.classList.contains('xiangqi-motion-stack'),
    ),
  );
  const carry = effects.find(effect => effect.element.classList.contains('xiangqi-motion-stack'))!;
  // Late completion callbacks must not shift a reveal whose face was known
  // at move start. Its browser timeline, rather than callback delivery, wins.
  now = 1000;
  await phase();
  assert.equal(root.querySelectorAll('.jieqi-reveal-stack').length, 0);
  const landing = effects.find(effect => effect.pending && effect.element === carry.element)!;
  assert.ok(Math.abs(landing.duration - 1000 / 30) < 1e-9);
  assert.ok(Math.abs(landing.startTime! - carry.startTime! - 100) < 1e-9);
  await phase();
  assert.equal(root.querySelectorAll('.jieqi-reveal-stack').length, 1);
  const turnover = effects.find(effect => effect.pending && effect.element === carry.element)!;
  assert.equal(turnover.duration, 200);
  assert.ok(Math.abs(turnover.startTime! - carry.startTime! - 4000 / 30) < 1e-9);
  for (const [i, offset] of [0, 1 / 3, 0.5, 2 / 3, 5 / 6, 1].entries())
    assert.ok(Math.abs(turnover.frames[i].offset! - offset) < 1e-9);
  // Travel starts at 0; landing ends at 133 1/3 ms; rotation starts at 200 ms
  // and completes at 333 1/3 ms, without accumulating RAF gaps between phases.
  assert.ok(Math.abs(turnover.startTime! + turnover.duration - carry.startTime! - 10000 / 30) < 1e-9);
  await settle(board);
});

for (const [duration, scale] of [
  [100, 0.5],
  [500, 1.5],
]) {
  test(`animation preference ${duration} scales the entire reference sequence`, async () => {
    const board = mount();
    board.set({ animation: { duration } });
    reveal(board);
    const carry = effects.find(effect => effect.element.classList.contains('xiangqi-motion-stack'))!;
    assert.equal(carry.duration, 100 * scale);
    await phase();
    const landing = effects.find(effect => effect.pending && effect.element === carry.element)!;
    assert.ok(Math.abs(landing.duration - (1000 / 30) * scale) < 1e-9);
    await phase();
    const turnover = effects.find(effect => effect.pending && effect.element === carry.element)!;
    assert.equal(turnover.duration, 200 * scale);
    assert.ok(
      Math.abs(turnover.startTime! + turnover.duration - carry.startTime! - (10000 / 30) * scale) < 1e-9,
    );
    await settle(board);
  });
}

for (const arrival of ['carry', 'landing', 'finished'] as const) {
  test(`authoritative reveal during ${arrival} preserves the optimistic move and cleans up`, async () => {
    const board = mount();
    board.move('a3', 'a4');
    if (arrival !== 'carry') await phase();
    if (arrival === 'finished') await phase();
    const originalPlan = board.state.animation.current?.plan;
    const existingEffects = effects.filter(effect => effect.pending);
    reveal(board);
    if (originalPlan) {
      assert.equal(board.state.animation.current?.plan, originalPlan);
      assert.ok(existingEffects.every(effect => !effect.cancelled));
    }
    await settle(board);
    assert.equal(board.state.boardState.pieces.get('a4')?.role, 'r-piece');
  });
}

for (const arrival of [150, 500]) {
  test(`a reveal received at ${arrival} ms consumes the elapsed hold without skipping turnover`, async () => {
    let now = 0;
    mock.method(performance, 'now', () => now);
    const board = mount();
    board.move('a3', 'a4');
    now = 100;
    await phase();
    now = 4000 / 30;
    await phase();
    now = arrival;
    reveal(board);
    await tick();
    const turnover = effects.find(
      effect => effect.pending && effect.element.classList.contains('jieqi-reveal-stack'),
    )!;
    assert.ok(turnover);
    const rotationStart = turnover.startTime! + turnover.duration / 3;
    assert.ok(Math.abs(rotationStart - Math.max(200, arrival)) < 1e-9);
    assert.ok(Math.abs(turnover.startTime! + turnover.duration - rotationStart - 4000 / 30) < 1e-9);
    await settle(board);
  });
}

test('a reveal retires an unrelated lifted selection', async () => {
  const board = mount();
  board.selectSquare('i3');
  board.state.dom.redrawNow();
  await phase();
  assert.equal(board.state.dom.elements.board.querySelectorAll('.xiangqi-motion-held').length, 1);
  board.selectSquare(null);
  board.state.dom.redrawNow();
  reveal(board);
  await settle(board);
});

test('a rapid reply interrupts a reveal without leaving motion layers', async () => {
  const board = mount();
  reveal(board);
  await phase();
  await phase();
  board.set({ fen: '9/4k4/9/9/9/9/R8/8X/9/4K4', lastMove: ['e:', 'e9'] });
  await settle(board);
});

test('backward replay slides a revealed piece back to its concealed origin', async () => {
  const board = mount();
  reveal(board);
  await settle(board);
  board.set({ fen: initial, lastMove: undefined }, { animation: 'slide' });
  assert.deepEqual(board.state.animation.current?.plan.anims.get('a3'), [0, 1, 0, 1]);
  await settle(board);
});

test('quiet corrections cancel motion immediately', async () => {
  const board = mount();
  reveal(board);
  board.set({ fen: initial, animation: { enabled: false } });
  await settle(board);
});

test('grabbing a travelling piece releases its animation before pointer movement', async () => {
  const board = mount();
  board.move('a3', 'a4');
  board.set({ movable: { dests: new Map([['a4', ['a5']]]) } });
  startDrag(board.state, pointer(650));
  await tick();
  assert.ok(board.state.draggable.current);
  assert.equal(board.state.animation.current, undefined);
  assert.equal(board.state.dom.elements.board.querySelectorAll('.xiangqi-motion-piece').length, 0);
  window.dispatchEvent(new window.Event('blur'));
  assert.equal(board.state.draggable.current, undefined);
  await settle(board);
});

test('touch cancellation releases a drag and its ghost', async () => {
  const board = mount();
  board.set({ draggable: { enabled: true } });
  startDrag(board.state, pointer(750));
  assert.ok(board.state.draggable.current);
  document.dispatchEvent(new window.Event('touchcancel'));
  assert.equal(board.state.draggable.current, undefined);
  await settle(board);
});

test('resizing during a reveal settles all browser animations', async () => {
  const board = mount();
  reveal(board);
  document.body.dispatchEvent(new window.Event('chessground.resize'));
  await settle(board);
});

test('concealed pieces retain shared poses while visible Xiangqi timing stays unchanged', async () => {
  const board = mount();
  board.move('a3', 'a4');
  const concealedCarry = effects.map(effect => effect.frames);
  await phase();
  const concealedLand = effects.slice(concealedCarry.length).map(effect => effect.frames);
  await settle(board);
  effects.length = 0;
  board.set({ fen: initial.replace('X7X', 'R7X'), animation: { enabled: false }, lastMove: undefined });
  board.state.dom.redrawNow();
  board.set({ animation: { enabled: true, duration: 200 } });
  board.move('a3', 'a4');
  assert.deepEqual(
    effects.map(effect => effect.frames),
    concealedCarry,
  );
  assert.ok(effects.every(effect => effect.duration === 150));
  await phase();
  assert.deepEqual(
    effects.slice(concealedCarry.length).map(effect => effect.frames),
    concealedLand,
  );
  assert.ok(effects.filter(effect => effect.pending).every(effect => effect.duration === 150));
  await settle(board);
});

test('unchanged public position synchronization does not cancel a reveal', async () => {
  const element = document.createElement('div');
  document.body.append(element);
  const board = createBoard(element, {
    definition: standardXiangqi,
    position: positionFromFen(initial + ' w', standardXiangqi),
    presentation: boardPresentation('interactive', 'red'),
    interaction: { mode: 'display' },
    services: { assetUrl: path => path, sound() {} },
  });
  try {
    const position = {
      ...positionFromFen(revealed + ' b', standardXiangqi),
      lastMove: ['a3', 'a4'] as const,
    };
    board.display(position, { kind: 'forward' });
    await phase();
    const pending = effects.filter(effect => effect.pending);
    assert.ok(pending.length);
    board.display(position);
    assert.ok(pending.every(effect => !effect.cancelled));
    for (let i = 0; i < 8; i++) await phase();
    assert.equal(element.querySelector('.xiangqi-motion-piece'), null);
  } finally {
    board.destroy();
    element.remove();
  }
});

test('disabling motion and destroying a board cancel every retained effect', async () => {
  const board = mount();
  reveal(board);
  board.set({ animation: { enabled: false } });
  assert.ok(effects.every(effect => effect.cancelled));
  board.set({ animation: { enabled: true } });
  board.set({ fen: initial, lastMove: undefined }, { animation: 'slide' });
  board.destroy();
  await tick();
  assert.ok(effects.every(effect => effect.cancelled));
  assert.equal(board.state.dom.elements.board.querySelector('.xiangqi-motion-piece'), null);
});

function pointer(clientY: number): Parameters<typeof startDrag>[1] {
  return {
    isTrusted: true,
    button: 0,
    clientX: 50,
    clientY,
    preventDefault() {},
    target: document.body,
    type: 'mousedown',
  } as unknown as Parameters<typeof startDrag>[1];
}
