import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { Chessground, Notation } from '../../board/tests/support/renderer.ts';

mock.module(new URL('../../lib/src/socket.ts', import.meta.url).href, {
  namedExports: { wsSend: () => {} },
});
const { getBoard } = await import('lib/view');
const { default: initManuals } = await import('../src/xiangqi.manuals.ts');

const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
const dimensions = { width: 9, height: 10 } as const;

test('static preview preserves pieces and shadows but cannot enable interaction or animation', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const ground = Chessground(element, {
    fen,
    dimensions,
    notation: Notation.XIANGQI_HANNUM,
    layeredPieces: true,
    staticPreview: true,
    viewOnly: false,
    animation: { enabled: true, duration: 250 },
  });
  try {
    assert.ok(element.classList.contains('cg-static-preview'));
    assert.ok(!element.classList.contains('manipulable'));
    assert.equal(element.querySelectorAll('cg-board > piece').length, 32);
    assert.equal(element.querySelectorAll('.xiangqi-piece-shadow').length, 32);
    ground.set({
      animation: { enabled: true, duration: 250 },
      viewOnly: false,
      draggable: { enabled: true },
      selectable: { enabled: true },
      drawable: { enabled: true },
    });
    assert.equal(ground.state.viewOnly, true);
    assert.equal(ground.state.draggable.enabled, false);
    assert.equal(ground.state.selectable.enabled, false);
    assert.equal(ground.state.drawable.enabled, false);
    assert.equal(ground.state.animation.enabled, false);
    ground.move('a4', 'a5');
    assert.ok(ground.state.boardState.pieces.has('a5'));
    assert.equal(ground.state.animation.current, undefined);
    ground.state.dom.redrawNow();
    assert.equal(element.querySelector('.xiangqi-motion-piece'), null);
    ground.toggleOrientation();
    assert.ok(element.classList.contains('cg-static-preview'));
    assert.throws(() => ground.set({ staticPreview: false }), /board construction/);
  } finally {
    ground.destroy();
    element.remove();
  }
});

test('ordinary interactive and view-only boards keep the existing animation defaults', () => {
  for (const viewOnly of [false, true]) {
    const element = document.createElement('div');
    document.body.append(element);
    const ground = Chessground(element, { fen, dimensions, viewOnly, notation: Notation.XIANGQI_HANNUM });
    try {
      assert.equal(ground.state.staticPreview, false);
      assert.ok(!element.classList.contains('cg-static-preview'));
      assert.equal(element.classList.contains('manipulable'), !viewOnly);
      ground.set({ animation: { enabled: true, duration: 250 } });
      assert.equal(ground.state.animation.enabled, true);
      assert.equal(ground.state.draggable.enabled, true);
      assert.equal(ground.state.selectable.enabled, true);
      assert.throws(() => ground.set({ staticPreview: true }), /board construction/);
    } finally {
      ground.destroy();
      element.remove();
    }
  }
});

test('every expanded Yicheng chapter uses static previews', () => {
  const host = document.createElement('div');
  host.innerHTML = `<div class="ancient-manuals__library"><div id="ancient-manuals-list">
    <button class="ancient-manual-card" data-manual-slug="yicheng"></button>
    </div></div><div id="ancient-manual-detail" hidden></div>`;
  document.body.append(host);
  // jsdom has no layout/scroll implementation.
  const scrollIntoView = HTMLElement.prototype.scrollIntoView;
  const matchMedia = window.matchMedia;
  HTMLElement.prototype.scrollIntoView = () => {};
  window.matchMedia = globalThis.matchMedia;
  try {
    initManuals({ language: 'en' });
    host.querySelector<HTMLButtonElement>('button')!.click();
    host.querySelectorAll('details').forEach(details => {
      details.open = true;
      details.dispatchEvent(new window.Event('toggle'));
    });
    const previews = host.querySelectorAll<HTMLElement>('.ancient-manual-game__board');
    assert.equal(previews.length, 134);
    for (const preview of previews) {
      assert.ok(preview.classList.contains('cg-static-preview'));
      assert.equal(getBoard(preview)!.getPresentation().motion.duration, 0);
      assert.deepEqual(getBoard(preview)!.getPresentation().feedback, { effects: [], audio: false });
    }
  } finally {
    host.querySelectorAll<HTMLElement>('.cg-wrap').forEach(node => getBoard(node)?.destroy());
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.matchMedia = matchMedia;
    host.remove();
  }
});
