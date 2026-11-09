import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, mock, test } from 'node:test';

import {
  createBoard,
  boardPresentation,
  standardXiangqi,
  miniXiangqi,
  threeKingdoms,
  type BoardDefinition,
  type BoardPosition,
  type BoardView,
} from '../src';
import { graphPoint } from '../src/renderer/graphGeometry';

interface Effect {
  element: Element;
  frames: Keyframe[];
  duration: number;
  cancelled: boolean;
  pending: boolean;
  finish(): void;
}
const effects: Effect[] = [];
const boards: BoardView[] = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const originalAnimate = window.Element.prototype.animate;
beforeEach(() => {
  window.Element.prototype.animate = function (frames, options) {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => {
      finish = resolve;
    });
    const effect: Effect = {
      element: this,
      frames: frames as Keyframe[],
      duration: Number((options as KeyframeAnimationOptions).duration),
      cancelled: false,
      pending: true,
      finish() {
        this.pending = false;
        finish();
      },
    };
    effects.push(effect);
    return {
      finished,
      cancel() {
        effect.cancelled = true;
        effect.finish();
      },
    } as Animation;
  };
  mock.method(window.HTMLElement.prototype, 'getBoundingClientRect', function (this: HTMLElement) {
    const id = this.closest('.lixiangqi-board')?.getAttribute('data-board-definition');
    const [width, height] =
      id === 'threeKingdoms'
        ? [threeKingdoms.geometry.width, threeKingdoms.geometry.height]
        : id === 'minixiangqi'
          ? [686, 686]
          : [882, 980];
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  });
});
afterEach(async () => {
  for (const board of boards.splice(0)) {
    board.destroy();
    board.element.remove();
  }
  await tick();
  effects.length = 0;
  window.Element.prototype.animate = originalAnimate;
  mock.restoreAll();
});
async function phase() {
  for (const effect of effects.filter(effect => effect.pending)) effect.finish();
  await tick();
}
async function settle() {
  for (let i = 0; i < 6; i++) await phase();
}

function mount(definition: BoardDefinition, reducedMotion = false) {
  const graph = definition.geometry.kind === 'graph';
  const from = graph ? 'wei:4:0' : 'a1',
    to = graph ? 'wei:4:1' : 'a2';
  const piece = { face: 'up', participant: 'red', role: 'chariot' } as const;
  const captured = { face: 'up', participant: 'black', role: 'soldier' } as const;
  const before: BoardPosition = {
    board: definition.id,
    active: 'red',
    pieces: new Map([
      [from, piece],
      [to, captured],
    ]),
  };
  const after: BoardPosition = {
    ...before,
    active: 'black',
    pieces: new Map([[to, piece]]),
    lastMove: [from, to],
  };
  const element = document.createElement('div');
  document.body.append(element);
  const cues: unknown[] = [];
  const board = createBoard(element, {
    definition,
    position: before,
    presentation: boardPresentation('interactive', 'red'),
    interaction: { mode: 'display' },
    services: { assetUrl: path => path, reducedMotion: () => reducedMotion, sound: cue => cues.push(cue) },
  });
  boards.push(board);
  return { board, before, after, from, to, cues };
}

for (const definition of [standardXiangqi, miniXiangqi, threeKingdoms]) {
  test(`${definition.id}: check stays inside the face through interrupted travel and selection`, async () => {
    const { board, before, after, from, to } = mount(definition);
    const general = { face: 'up', participant: 'red', role: 'general' } as const;
    const checkedBefore = { ...before, pieces: new Map([[from, general]]), checked: [from] };
    const checkedAfter = { ...after, pieces: new Map([[to, general]]), checked: [to] };
    board.display(checkedBefore, { kind: 'jump' });
    await tick();
    const verify = (lifted: boolean) => {
      const halos = board.element.querySelectorAll('.xiangqi-check-halo');
      assert.equal(halos.length, 1);
      assert.equal(halos[0].parentElement?.classList.contains('xiangqi-motion-stack'), lifted);
      assert.ok(halos[0].closest('piece:not(.fading)'));
    };
    verify(false);
    for (let i = 0; i < 12; i++) {
      board.display(i % 2 ? checkedBefore : checkedAfter, { kind: i % 2 ? 'backward' : 'forward' });
      verify(i % 2 === 0);
    }
    await settle();
    verify(false);
    board.setInteraction({ mode: 'play', participant: 'red', destinations: new Map([[from, [to]]]) });
    board.select(from);
    await tick();
    verify(true);
    board.display({ ...checkedAfter, checked: [] }, { kind: 'forward' });
    assert.equal(board.element.querySelectorAll('.xiangqi-check-halo').length, 0);
    board.display(checkedBefore, { kind: 'jump' });
    await tick();
    board.setPresentation({ ...board.getPresentation(), highlight: false });
    await tick();
    assert.equal(board.element.querySelectorAll('.xiangqi-check-halo').length, 0);
  });

  test(`${definition.id}: captured and missing pieces cannot retain check halos`, async () => {
    const { board, before, after, from, to } = mount(definition);
    board.display({ ...before, checked: [to] }, { kind: 'jump' });
    await tick();
    assert.equal(board.element.querySelectorAll('.xiangqi-check-halo').length, 1);
    board.display({ ...after, checked: [to] }, { kind: 'forward' });
    assert.equal(board.element.querySelectorAll('.fading .xiangqi-check-halo').length, 0);
    assert.equal(board.element.querySelectorAll('piece:not(.fading) .xiangqi-check-halo').length, 1);
    board.display({ ...after, pieces: new Map(), checked: [from, to] }, { kind: 'jump' });
    await tick();
    assert.equal(board.element.querySelectorAll('.xiangqi-check-halo').length, 0);
  });

  test(`${definition.id}: capture uses shared lift, travel, land and paper connector timeline`, async () => {
    const { board, after, cues } = mount(definition);
    board.display(after, { kind: 'forward', id: 'move', effects: ['capture'] });
    const stack = effects.find(effect => effect.element.classList.contains('xiangqi-motion-stack'))!;
    assert.ok(stack);
    assert.equal(stack.duration, 150);
    assert.match(String(stack.frames[1].transform), /rotateX\(27deg\)/);
    assert.equal(stack.frames[1].offset, 0.2);
    const travel = effects.find(effect => effect.element.tagName === 'PIECE')!;
    const connector = effects.find(effect =>
      effect.element.classList.contains('xiangqi-last-move-connector'),
    )!;
    assert.equal(connector.duration, travel.duration);
    assert.deepEqual(
      connector.frames.map(frame => frame.offset),
      travel.frames.map(frame => frame.offset),
    );
    assert.ok(effects.some(effect => effect.element.classList.contains('fading')));
    assert.ok(effects.every(effect => effect.element.tagName !== 'BUTTON'));
    assert.equal(board.element.querySelectorAll('.board-marker.last-move-origin').length, 1);
    board.display(after, { kind: 'confirmation', id: 'move', effects: ['capture'] });
    assert.equal(cues.length, 1);
    assert.equal(stack.cancelled, false);
    await phase();
    const landing = effects.find(effect => effect.pending && effect.element === stack.element)!;
    assert.equal(landing.duration, 150);
    assert.match(String(landing.frames.at(-1)!.transform), /rotateX\(0deg\)/);
    await settle();
    assert.equal(board.element.querySelectorAll('.xiangqi-motion-piece, .fading').length, 0);
    assert.equal(board.element.querySelectorAll('.xiangqi-last-move-highlight').length, 1);
    assert.ok(effects.every(effect => effect.cancelled));
  });

  test(`${definition.id}: backward capture restores the captured piece and slides to the initial position`, async () => {
    const { board, before, after, cues } = mount(definition);
    board.display(after, { kind: 'jump' });
    board.display(before, { kind: 'backward', effects: [] });
    assert.ok(effects.some(effect => effect.element.tagName === 'PIECE'));
    assert.equal(board.element.querySelectorAll('.xiangqi-motion-stack').length, 0);
    assert.deepEqual(cues, [{ move: true, effects: [] }]);
    await settle();
    assert.equal(board.position().pieces.size, 2);
    assert.equal(board.element.querySelectorAll('.xiangqi-last-move-connector').length, 0);
    assert.ok(effects.every(effect => effect.cancelled));
  });

  test(`${definition.id}: unchanged sync preserves travel; a jump cancels every layer`, async () => {
    const { board, before, after } = mount(definition);
    board.display(after, { kind: 'forward', effects: [] });
    board.display(after, { kind: 'jump' });
    assert.ok(effects.some(effect => !effect.cancelled));
    board.display(before, { kind: 'jump' });
    await tick();
    assert.ok(effects.every(effect => effect.cancelled));
    assert.equal(
      board.element.querySelectorAll('.xiangqi-motion-piece, .xiangqi-motion-camera, .fading').length,
      0,
    );
  });

  test(`${definition.id}: reduced motion retains resting indicators without travel or effects`, async () => {
    const { board, after } = mount(definition, true);
    board.display(after, { kind: 'forward', effects: ['capture'] });
    await tick();
    assert.equal(effects.length, 0);
    assert.equal(board.element.querySelectorAll('.xiangqi-board-animation').length, 0);
    assert.equal(board.element.querySelectorAll('.xiangqi-last-move-highlight').length, 1);
  });
}

test('Three Kingdoms selection, perspective change, and disposal use the shared motion lifecycle', async () => {
  const { board, before, after, from, to } = mount(threeKingdoms);
  board.setInteraction({
    mode: 'play',
    participant: 'red',
    input: 'both',
    showDestinations: true,
    destinations: new Map([[from, [to]]]),
    onMove() {},
  });
  board.select(from);
  assert.ok(
    effects.some(
      effect => effect.duration === 33 && effect.element.classList.contains('xiangqi-motion-stack'),
    ),
  );
  board.display(after, { kind: 'forward', effects: [] });
  board.setPresentation({ ...board.getPresentation(), perspective: 'green' });
  await tick();
  assert.ok(effects.every(effect => effect.cancelled));
  assert.equal(board.element.querySelectorAll('.xiangqi-motion-camera').length, 0);
  board.display(before, { kind: 'jump' });
  board.display(after, { kind: 'forward', effects: [] });
  board.destroy();
  await tick();
  assert.ok(effects.every(effect => effect.cancelled));
});

test('static and lifted faces share the geometry orientation rule', () => {
  const css = readFileSync(new URL('../css/_board.scss', import.meta.url), 'utf8');
  assert.match(
    css,
    /piece::after,\s*\.xiangqi-motion-face\s*\{\s*rotate: var\(--board-face-rotation, 0deg\);/,
  );
});

test('Three Kingdoms indicators stay centered on intersections across territories, seats and sizes', () => {
  const { board, after } = mount(threeKingdoms);
  const surface = board.element.querySelector<HTMLElement>('.graph-board__surface')!;
  const geometry = threeKingdoms.geometry;
  const locations = ['wei', 'shu', 'wu'].flatMap(territory =>
    ['0:0', '4:2', '8:4'].map(at => `${territory}:${at}`),
  );
  for (const width of [360, 768, 1200]) {
    const height = (width * geometry.height) / geometry.width;
    surface.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      toJSON() {},
    });
    for (const perspective of ['red', 'black', 'green']) {
      board.setPresentation({ ...board.getPresentation(), perspective });
      for (const location of locations) {
        board.display(
          {
            ...after,
            pieces: new Map([[location, [...after.pieces.values()][0]]]),
            lastMove: ['wei:4:0', location],
          },
          { kind: 'jump' },
        );
        const marker = surface.querySelector<HTMLElement>('.board-marker.last-move-destination')!;
        const piece = surface.querySelector<HTMLElement>('piece')!;
        assert.equal(marker.style.transform, piece.style.transform);
        const [x, y] = graphPoint(geometry, location, perspective);
        const [px, py] = marker.style.transform.match(/-?[\d.]+(?=px)/g)!.map(Number);
        assert.ok(Math.abs(px + parseFloat(marker.style.width) / 2 - (x * width) / geometry.width) < 1e-7);
        assert.ok(Math.abs(py + parseFloat(marker.style.height) / 2 - (y * height) / geometry.height) < 1e-7);
        const connector = surface.querySelector('line');
        if (connector)
          for (const name of ['x1', 'y1', 'x2', 'y2'])
            assert.ok(Number.isFinite(Number(connector.getAttribute(name))));
      }
    }
  }
  board.setPresentation({ ...board.getPresentation(), highlight: false });
  assert.equal(
    surface.querySelectorAll('.board-marker, .xiangqi-last-move-highlight, .xiangqi-last-move-connector')
      .length,
    0,
  );
});

test('Three Kingdoms resize cancels travel and releases its observer on disposal', async () => {
  let resize!: () => void,
    disconnected = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  });
  try {
    const { board, after } = mount(threeKingdoms);
    board.display(after, { kind: 'forward', effects: [] });
    resize();
    await tick();
    assert.ok(effects.every(effect => effect.cancelled));
    assert.equal(board.element.querySelectorAll('.xiangqi-motion-camera').length, 0);
    board.destroy();
    assert.ok(disconnected);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous);
    else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
});
