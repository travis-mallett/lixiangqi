import assert from 'node:assert/strict';
import test from 'node:test';

import { engineProgress } from '../src/ceval/engineProgress.ts';
import { updateProgressBar } from '../src/view/progressBar.ts';

test('engine download and startup share the same animated accessible progress line', () => {
  const element = document.createElement('div');
  element.append(document.createElement('span'));
  updateProgressBar(element, engineProgress(true, { state: 'downloading', bytes: 25, total: 100 }));
  assert.equal(element.getAttribute('role'), 'progressbar');
  assert.equal(element.getAttribute('aria-valuenow'), '25');
  assert.equal((element.firstElementChild as HTMLElement).style.width, '25%');
  assert.equal(element.classList.contains('active'), true);
  updateProgressBar(element, engineProgress(true, { state: 'initializing' }));
  assert.equal(element.hasAttribute('aria-valuenow'), false, 'startup must not pretend to be 100% ready');
  assert.equal(element.classList.contains('indeterminate'), true);
  assert.equal(element.classList.contains('active'), true);
  updateProgressBar(element, engineProgress(false, { state: 'ready' }));
  assert.equal(element.hidden, true);
  assert.equal(element.classList.contains('active'), false);
});
