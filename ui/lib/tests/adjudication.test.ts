import assert from 'node:assert/strict';
import test from 'node:test';

import { isXiangqiCheckmate } from '../src/game/adjudication';
import { renderAdjudication } from '../src/game/view/adjudication';

test('live and example notice uses current state, ending precedence and shared localization', () => {
  document.documentElement.lang = 'en';
  const warning = renderAdjudication({ variation: 'perpetual-check' });
  assert.equal(warning?.text, 'Perpetual check limit reached. Choose a different continuation.');
  assert.equal(warning?.data?.attrs?.role, 'status');
  assert.equal(renderAdjudication({ variation: 'perpetual-check' }, false), undefined);
  assert.equal(renderAdjudication({}), undefined);
  assert.equal(
    renderAdjudication({ termination: 'mutual-check', variation: 'perpetual-check' })?.text,
    'Draw: mutual perpetual check.',
  );
  document.documentElement.lang = 'zh';
  assert.equal(renderAdjudication({ variation: 'perpetual-check' })?.text, '长将已达上限，请变招。');
  document.documentElement.lang = 'en';
});

test('only checkmate endings receive the mate presentation', () => {
  assert.equal(isXiangqiCheckmate('mate', 'checkmate', true), true);
  assert.equal(isXiangqiCheckmate('mate', 'stalemate', false), false);
  assert.equal(isXiangqiCheckmate('variantEnd', 'forced-variation', true), false);
  assert.equal(isXiangqiCheckmate('draw', 'mutual-check', true), false);
  assert.equal(isXiangqiCheckmate('draw', 'no-capture', true), false);
  assert.equal(isXiangqiCheckmate(undefined, undefined, true), false);
});

test('older game data falls back to mate status and available check state', () => {
  assert.equal(isXiangqiCheckmate('mate'), true);
  assert.equal(isXiangqiCheckmate('mate', null, true), true);
  assert.equal(isXiangqiCheckmate('mate', null, false), false);
});
