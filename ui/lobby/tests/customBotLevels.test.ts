import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, attributesModule, classModule, eventListenersModule, propsModule } from 'snabbdom';

import { levelButtons } from '../src/view/setup/components/levelButtons';

const patch = init([attributesModule, propsModule, classModule, eventListenersModule]);

(globalThis as any).site = { blindMode: false };
(globalThis as any).i18n = {
  site: {
    aiDifficulty: 'AI difficulty',
    passRate: 'Pass rate',
    difficulty: 'Difficulty',
    side: 'Side',
    white: 'White',
    black: 'Black',
    random: 'Random',
  },
};

test('custom bot slider exposes ten choices and selects the shared level', () => {
  let selected = 98;
  const ctrl = {
    aiLevel: (value?: number) => (value === undefined ? selected : (selected = value)),
    aiStats: undefined,
    aiStatsLoading: false,
    color: () => 'random',
  } as any;
  const mount = document.createElement('div');
  document.body.append(mount);
  const tree = patch(mount, levelButtons(ctrl));
  const root = tree.elm as HTMLElement;
  const slider = root.querySelector<HTMLInputElement>('input#sf_level')!;

  assert.equal(slider.min, '0');
  assert.equal(slider.max, '9');
  assert.equal(slider.value, '2');
  assert.equal(root.querySelector('output')?.textContent, '2');

  slider.value = '9';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(selected, 720);
  root.remove();
});
