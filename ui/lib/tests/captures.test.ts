import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesModule, init } from 'snabbdom';

import type { JieqiCapture } from '../src/game/jieqi';
import { capturedPieces } from '../src/game/view/captures';

const patch = init([attributesModule]);
const ledger: JieqiCapture[] = [
  { side: 'black', square: 'a10', concealed: true, ply: 1 },
  { side: 'black', square: 'b10', concealed: true, ply: 3 },
  { side: 'black', square: 'c10', concealed: false, role: 'horse', ply: 5 },
  { side: 'black', square: 'd10', concealed: false, role: 'horse', ply: 7 },
  { side: 'red', square: 'a1', concealed: true, ply: 8 },
];

function render(captures: JieqiCapture[], ply: number): HTMLElement {
  return patch(document.createElement('div'), capturedPieces(captures, 'black', ply)).elm as HTMLElement;
}

test('live hidden captures group as backs, without revealing a role or dimming them', () => {
  const tray = render(ledger, 8);
  assert.equal(tray.children.length, 2);
  assert.equal(tray.querySelectorAll('piece._-piece').length, 1);
  assert.equal(tray.querySelectorAll('piece.n-piece').length, 1);
  assert.deepEqual(
    [...tray.querySelectorAll('.jieqi-captures__count')].map(n => n.textContent),
    ['2', '2'],
  );
  assert.equal(tray.querySelector('.jieqi-captures__piece--concealed'), null);
  assert.match(tray.firstElementChild!.getAttribute('aria-label')!, / × 2$/);
});

test('finished replay keeps hidden-at-capture and revealed-at-capture groups distinct', () => {
  const revealed = ledger.map(capture => ({ ...capture, role: capture.role ?? 'horse' }));
  const tray = render(revealed, 8);
  assert.equal(tray.children.length, 2);
  assert.equal(tray.querySelectorAll('piece.n-piece').length, 2);
  assert.equal(tray.querySelectorAll('.jieqi-captures__piece--concealed').length, 1);
  assert.equal(
    tray.querySelector('.jieqi-captures__piece--concealed .jieqi-captures__count')!.textContent,
    '2',
  );
});

test('replay filters captures by ply before grouping and removes stale badges when rewound', () => {
  let tray = patch(document.createElement('div'), capturedPieces(ledger, 'black', 8));
  tray = patch(tray, capturedPieces(ledger, 'black', 1));
  const element = tray.elm as HTMLElement;
  assert.equal(element.children.length, 1);
  assert.equal(element.querySelector('.jieqi-captures__count'), null);
  tray = patch(tray, capturedPieces(ledger, 'black', 0));
  assert.equal((tray.elm as HTMLElement).children.length, 0);
});
