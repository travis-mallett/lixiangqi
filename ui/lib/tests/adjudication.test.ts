import assert from 'node:assert/strict';
import test from 'node:test';

import { isXiangqiMate } from '../src/game/adjudication';
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

test('checkmate and stalemate share mate events while other endings do not', () => {
  for (const termination of ['checkmate', 'stalemate']) {
    assert.equal(isXiangqiMate('mate', termination), true);
    assert.equal(isXiangqiMate(undefined, termination), true);
  }
  for (const termination of ['forced-variation', 'mutual-check', 'no-capture'])
    assert.equal(isXiangqiMate('mate', termination), false);
  assert.equal(isXiangqiMate('mate'), true);
  assert.equal(isXiangqiMate('mate', null), true);
  assert.equal(isXiangqiMate('draw'), false);
  assert.equal(isXiangqiMate(), false);
});
