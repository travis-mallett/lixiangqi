import { Chessground } from 'chessgroundx/chessground';
import { Notation } from 'chessgroundx/types';
import assert from 'node:assert/strict';
import test from 'node:test';

test('Xiangqi boards fill widths that are not divisible into physical-pixel cells', () => {
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
    });
    const container = wrap.querySelector('cg-container') as HTMLElement;

    assert.equal(container.style.width, '340px');
    assert.equal(container.style.height, '377.7777777778px');
    ground.destroy();
  } finally {
    wrap.remove();
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: previousDevicePixelRatio,
    });
  }
});
