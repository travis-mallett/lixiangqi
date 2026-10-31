import assert from 'node:assert/strict';
import test from 'node:test';

import { Chessground, Notation, rectangularMotion } from '../../board/tests/support/renderer.ts';

test('Xiangqi boards preserve exact dimensions while CSS owns the theme viewport', () => {
  const previousDevicePixelRatio = window.devicePixelRatio;
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.25 });

  const wrap = document.createElement('div');
  wrap.getBoundingClientRect = () => ({
    bottom: 377.7777777778,
    height: 377.7777777778,
    left: 0,
    right: 340,
    top: 0,
    width: 340,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  document.body.append(wrap);

  try {
    const ground = Chessground(wrap, {
      dimensions: { width: 9, height: 10 },
      notation: Notation.XIANGQI_HANNUM,
      layeredPieces: true,
      pieceMotion: rectangularMotion,
      addDimensionsCssVarsTo: wrap,
    });
    const container = wrap.querySelector('cg-container') as HTMLElement;

    assert.equal(wrap.style.getPropertyValue('--cg-width'), '340px');
    assert.equal(wrap.style.getPropertyValue('--cg-height'), '377.7777777778px');
    assert.equal(container.style.width, '');
    assert.equal(container.style.height, '');
    ground.destroy();
  } finally {
    wrap.remove();
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: previousDevicePixelRatio,
    });
  }
});
