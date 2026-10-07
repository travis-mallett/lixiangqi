import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, attributesModule, propsModule, classModule } from 'snabbdom';

import botMap, { centerBotLevel } from '../src/view/botMap';

const patch = init([attributesModule, propsModule, classModule]);

(globalThis as any).i18n = {
  site: {
    aiNameLevelAiLevel: (name: string, level: number) => `${name} level ${level}`,
    backToHomepage: 'Back to homepage',
    playAgainstComputer: 'Play against computer',
    challengeHigherLevel: 'Challenge a Higher Level',
    botLevelCleared: (level: number) => `Level ${level} cleared`,
    botLevelLocked: (level: number) => `Level ${level} locked`,
  },
};

test('map orders all levels upward and keeps custom setup outside the scroller', () => {
  const started: number[] = [];
  const opened: string[] = [];
  let redraws = 0;
  const ctrl = {
    botMapOpen: true,
    redraw: () => redraws++,
    setupCtrl: {
      gameType: null,
      loading: false,
      botCompletedLevel: () => 0,
      botProgressReady: () => true,
      startBot: (level: number) => started.push(level),
      openModal: (type: string) => opened.push(type),
    },
  } as any;
  const mount = document.createElement('div');
  document.body.append(mount);
  const tree = patch(mount, botMap(ctrl));
  const root = tree.elm as HTMLElement;
  const buttons = root.querySelectorAll<HTMLButtonElement>('li button');
  assert.equal(buttons.length, 720);
  assert.equal(buttons[0].textContent, '720');
  assert.equal(buttons[719].textContent, '1');
  buttons[719].click();
  buttons[0].click();
  assert.deepEqual(started, [1]);
  assert.equal(root.querySelectorAll('li button:disabled').length, 719);
  assert.equal(buttons[719].getAttribute('aria-current'), 'step');
  assert.equal(root.querySelector('.lobby__bot-map__scroll footer'), null);
  root.querySelector<HTMLButtonElement>('footer button')!.click();
  assert.deepEqual(opened, ['ai']);
  root.querySelector<HTMLButtonElement>('header button')!.click();
  assert.equal(ctrl.botMapOpen, false);
  assert.equal(redraws, 2);
  root.remove();
});

for (const completed of [1, 98, 720])
  test(`a win at level ${completed} clears everything below it and unlocks the next level`, () => {
    const ctrl = {
      setupCtrl: {
        botCompletedLevel: () => completed,
        botProgressReady: () => true,
      },
    } as any;
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = patch(mount, botMap(ctrl)).elm as HTMLElement;
    assert.equal(root.querySelectorAll('button.cleared').length, completed);
    assert.equal(root.querySelectorAll('li button:disabled').length, Math.max(0, 719 - completed));
    assert.equal(
      root.querySelector('[aria-current]')?.getAttribute('data-level'),
      completed === 720 ? undefined : String(completed + 1),
    );
    root.remove();
  });

test('centering uses the scroll viewport rather than the document position', () => {
  const scroller = document.createElement('div');
  const target = document.createElement('button');
  target.dataset.level = '99';
  scroller.append(target);
  Object.defineProperty(scroller, 'clientHeight', { value: 400 });
  scroller.getBoundingClientRect = () => ({ top: 150 }) as DOMRect;
  target.getBoundingClientRect = () => ({ top: 900, height: 64 }) as DOMRect;
  scroller.scrollTop = 50;
  centerBotLevel(scroller, 99);
  assert.equal(scroller.scrollTop, 632);
});
