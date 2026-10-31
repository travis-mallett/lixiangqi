import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesModule, classModule, init } from 'snabbdom';

import { renderReplayControls } from '../src/view/replayControls';

test('transport buttons have names and dispatch native activation once, respecting disabled controls', t => {
  const matchMedia = window.matchMedia;
  window.matchMedia = globalThis.matchMedia;
  t.after(() => {
    window.matchMedia = matchMedia;
  });
  const calls: string[] = [];
  const patch = init([attributesModule, classModule]);
  const mount = document.createElement('div');
  document.body.append(mount);
  const vnode = patch(
    mount,
    renderReplayControls({
      selector: 'div.test-controls',
      enabled: { first: false, prev: false, next: true, last: true },
      onClick: action => calls.push(action),
    }),
  );
  const root = vnode.elm as HTMLElement;
  root.releasePointerCapture = () => {};
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
    assert.ok(button.title);
    assert.equal(button.getAttribute('aria-label'), button.title);
    button.click();
  }
  assert.deepEqual(calls, ['next', 'last']);
  const next = root.querySelector<HTMLButtonElement>('[data-act="next"]')!;
  next.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  next.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
  next.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.deepEqual(calls, ['next', 'last', 'next']);
  root.remove();
});
