import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initPuzzleThemesFocus } from '../src/puzzleThemesFocus.ts';

test('theme links regain focus after keyboard and pointer navigation through both history paths', async t => {
  document.body.innerHTML = `
    <main class="puzzle-themes-page">
      <a class="puzzle-themes__link" href="/training/themes/mate-in-4">Mate in 4</a>
      <a class="puzzle-themes__link" href="/training/themes/mate-in-5">Mate in 5</a>
      <details><summary>Learn</summary></details>
    </main>`;

  const page = document.querySelector<HTMLElement>('.puzzle-themes-page')!;
  const [mateIn4, mateIn5] = page.querySelectorAll<HTMLAnchorElement>('.puzzle-themes__link');
  const summary = page.querySelector('summary')!;
  initPuzzleThemesFocus(page);
  page.addEventListener('click', event => event.preventDefault());
  // Theme lessons close on BFCache restoration and focus their summary.
  window.addEventListener('pageshow', event => {
    if (event.persisted) summary.focus();
  });

  // Enter on an anchor produces a click with detail 0; simulate that activation and a BFCache return.
  mateIn4.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  mateIn4.dispatchEvent(
    new window.MouseEvent('click', { button: 0, bubbles: true, cancelable: true, detail: 0 }),
  );
  const backForward = new window.Event('pageshow');
  Object.defineProperty(backForward, 'persisted', { value: true });
  window.dispatchEvent(backForward);
  await new Promise<void>(resolve => queueMicrotask(resolve));
  assert.equal(document.activeElement, mateIn4);
  assert.notEqual(document.activeElement, summary);

  // A full history traversal is not persisted; browsers report its navigation type instead.
  t.mock.method(performance, 'getEntriesByType', () => [{ type: 'back_forward' }] as any);
  mateIn5.dispatchEvent(
    new window.MouseEvent('click', { button: 0, bubbles: true, cancelable: true, detail: 1 }),
  );
  const reloadBack = new window.Event('pageshow');
  Object.defineProperty(reloadBack, 'persisted', { value: false });
  window.dispatchEvent(reloadBack);
  await new Promise<void>(resolve => queueMicrotask(resolve));
  assert.equal(document.activeElement, mateIn5);
  assert.notEqual(document.activeElement, summary);
});
