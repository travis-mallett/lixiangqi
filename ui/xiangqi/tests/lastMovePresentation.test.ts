import assert from 'node:assert/strict';
import test from 'node:test';

import { makeXiangqiGround } from '../src/index.ts';

test('last-move connector follows moves, orientation, and highlight visibility', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, {
    lastMove: 'a4a1',
    animationDuration: 0,
    viewOnly: true,
  });
  const connector = () => element.querySelector('.xiangqi-last-move-connector');
  const endpoints = () => {
    const line = connector()!.firstElementChild!;
    return ['x1', 'y1', 'x2', 'y2'].map(name => Number(line.getAttribute(name)));
  };
  try {
    assert.deepEqual(endpoints(), [0.5, 6.9, 0.5, 9]);
    assert.equal(element.querySelectorAll('piece.xiangqi-last-move-destination').length, 1);
    const original = connector();
    ground.state.dom.redrawNow();
    assert.equal(connector(), original);

    ground.toggleOrientation();
    assert.deepEqual(endpoints(), [8.5, 3.1, 8.5, 1]);

    ground.set({ lastMove: ['h1', 'g3'] });
    ground.state.dom.redrawNow();
    const [x1, y1, x2, y2] = endpoints();
    assert.ok(x1 > 1.5 && x1 < 2.5 && x2 > x1);
    assert.ok(y1 > 0.5 && y1 < 2.5 && y2 > y1);
    assert.equal(element.querySelectorAll('.xiangqi-last-move-connector').length, 1);

    ground.set({ highlight: { lastMove: false } });
    ground.state.dom.redrawNow();
    assert.equal(connector(), null);
    assert.equal(element.querySelector('piece.xiangqi-last-move-destination'), null);

    ground.set({ highlight: { lastMove: true }, lastMove: undefined });
    ground.state.dom.redrawNow();
    assert.equal(connector(), null);
  } finally {
    ground.destroy();
    element.remove();
  }
});
