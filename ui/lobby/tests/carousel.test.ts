import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { makeCarousel } from '../src/view/carousel';

const cash = await import('../../../public/javascripts/vendor/cash.min.js');
Object.assign(globalThis, { $: cash.default });

const historyKey = 'lobbyCarouselKeyboardReturn';

type HistoryOptions = {
  navigation?: string;
  target?: string;
  inputBeforeReady?: 'keydown' | 'pointerdown';
  focusBeforeReady?: boolean;
};

function carousel(t: TestContext, count = 5, initialWidth = 612, options: HistoryOptions = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let resize: (() => void) | undefined;
  let pageShow: ((event: PageTransitionEvent) => void) | undefined;
  let pageHide: (() => void) | undefined;
  const inputHandlers = new Map<string, EventListener>();
  t.mock.method(document, 'addEventListener', (type: string, callback: EventListener) => {
    inputHandlers.set(type, callback);
  });
  t.mock.method(performance, 'getEntriesByType', () => [{ type: options.navigation ?? 'navigate' }] as any);
  window.history.replaceState(
    {
      unrelated: 42,
      ...(options.target ? { [historyKey]: { selector: '.carousel', href: options.target } } : {}),
    },
    '',
  );
  t.mock.method(window, 'addEventListener', (type: string, callback: () => void) => {
    if (type === 'resize') resize = callback;
    if (type === 'pageshow') pageShow = callback;
    if (type === 'pagehide') pageHide = callback;
  });
  document.body.innerHTML = `<button id="outside">Outside</button><div class="carousel" style="gap:18px">
    <div class="carousel__track">${Array.from({ length: count }, (_, i) => `<a href="/article/${i}">${i}</a>`).join('')}</div>
    <div class="carousel__controls"><button class="carousel__prev"></button><button class="carousel__next"></button></div>
  </div>`;
  const el = document.querySelector<HTMLElement>('.carousel')!;
  const track = el.querySelector<HTMLElement>('.carousel__track')!;
  let width = initialWidth;
  Object.defineProperty(el, 'clientWidth', { get: () => width });
  el.getBoundingClientRect = () => ({ left: 0, right: width, width }) as DOMRect;
  for (const child of track.children) {
    child.getBoundingClientRect = () => {
      const left = [...track.children].indexOf(child) * 210;
      return { left, right: left + 192, width: 192 } as DOMRect;
    };
  }
  makeCarousel({ selector: '.carousel', itemWidth: 192, pauseFor: 10 });
  if (options.inputBeforeReady)
    inputHandlers.get(options.inputBeforeReady)!(new window.Event(options.inputBeforeReady));
  if (options.focusBeforeReady) document.querySelector<HTMLButtonElement>('#outside')!.focus();
  t.mock.timers.tick(0);
  // Run after the actual component listeners, without navigating jsdom away from the fixture.
  el.addEventListener('click', event => event.preventDefault());
  return {
    link: (index: number) => track.querySelector<HTMLAnchorElement>(`[href="/article/${index}"]`)!,
    pageHide: () => pageHide!(),
    pageShow: () => pageShow!({ persisted: true } as PageTransitionEvent),
    el,
    track,
    order: () => [...track.children].map(k => k.textContent),
    click: (direction: 'prev' | 'next') =>
      el.querySelector<HTMLButtonElement>(`.carousel__${direction}`)!.click(),
    resize: (nextWidth: number) => {
      width = nextWidth;
      resize!();
    },
  };
}

test('Lichess carousel advances every ten seconds with a 600ms eased slide and loops indefinitely', t => {
  const c = carousel(t);
  assert.equal(c.el.style.visibility, 'visible');
  assert.equal((c.track.firstElementChild as HTMLElement).style.width, '192px');
  t.mock.timers.tick(9999);
  assert.equal((c.track.firstElementChild as HTMLElement).style.transform, '');
  t.mock.timers.tick(1);
  assert.equal((c.track.firstElementChild as HTMLElement).style.transition, 'transform 0.6s ease');
  assert.equal((c.track.firstElementChild as HTMLElement).style.transform, 'translateX(-210px)');
  t.mock.timers.tick(599);
  assert.equal(c.order()[0], '0');
  t.mock.timers.tick(1);
  assert.deepEqual(c.order(), ['1', '2', '3', '4', '0']);
  assert.equal((c.track.firstElementChild as HTMLElement).style.transform, '');
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(9400);
    t.mock.timers.tick(600);
  }
  assert.deepEqual(c.order(), ['0', '1', '2', '3', '4']);
});

test('manual navigation wraps in both directions and restarts autoplay', t => {
  const c = carousel(t);
  c.click('prev');
  assert.deepEqual(c.order(), ['4', '0', '1', '2', '3']);
  c.click('next');
  assert.deepEqual(c.order(), ['0', '1', '2', '3', '4']);
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(600);
  assert.equal(c.order()[0], '1');
  c.resize(402);
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(600);
  assert.equal(c.order()[0], '2');
});

test('touch swipes navigate, suppress link activation, and retain autoplay', t => {
  const c = carousel(t);
  const pointer = (type: string, x: number, y: number) => {
    const event = new window.Event(type, { bubbles: true });
    Object.assign(event, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y });
    c.track.firstElementChild!.dispatchEvent(event);
  };
  pointer('pointerdown', 150, 20);
  pointer('pointerup', 40, 25);
  assert.equal(c.order()[0], '1');
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  c.track.firstElementChild!.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  pointer('pointerdown', 40, 20);
  pointer('pointerup', 150, 25);
  assert.equal(c.order()[0], '0');
  pointer('pointerdown', 150, 20);
  pointer('pointerup', 100, 120);
  assert.equal(c.order()[0], '0');
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(600);
  assert.equal(c.order()[0], '1');
});

test('manual navigation during a slide cancels its pending rotation', t => {
  const c = carousel(t);
  t.mock.timers.tick(10_000);
  c.click('next');
  t.mock.timers.tick(600);
  assert.deepEqual(c.order(), ['1', '2', '3', '4', '0']);
});

test('resizing refits whole cards, including a container narrower than the target width', t => {
  const c = carousel(t);
  c.resize(402);
  assert.equal((c.track.firstElementChild as HTMLElement).style.width, '192px');
  c.resize(150);
  assert.equal((c.track.firstElementChild as HTMLElement).style.width, '150px');
});

test('all posts fitting in the carousel remain still', t => {
  const c = carousel(t, 2);
  t.mock.timers.tick(30_000);
  assert.deepEqual(c.order(), ['0', '1']);
  assert.equal((c.track.firstElementChild as HTMLElement).style.transform, '');
});

function activate(link: HTMLAnchorElement, options: MouseEventInit = {}) {
  link.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, button: 0, ...options }),
  );
}

test('history reload reveals the originating card and preserves other history state', t => {
  const c = carousel(t, 5, 402, { navigation: 'back_forward', target: '/article/3' });
  assert.equal(document.activeElement, c.link(3));
  assert.equal(c.order()[0], '3');
  assert.deepEqual(window.history.state, { unrelated: 42 });
});

test('fresh loads do not restore a stale card target', t => {
  const c = carousel(t, 5, 402, { target: '/article/3' });
  assert.equal(document.activeElement, document.body);
  assert.equal(c.order()[0], '0');
});

test('ordinary reloads do not restore a stale card target', t => {
  const c = carousel(t, 5, 402, { navigation: 'reload', target: '/article/3' });
  assert.equal(document.activeElement, document.body);
  assert.equal(c.order()[0], '0');
});

test('BFCache restoration uses keyboard activation and consumes its history target', t => {
  const c = carousel(t);
  c.link(1).focus();
  activate(c.link(1));
  assert.equal(window.history.state[historyKey].href, '/article/1');
  c.pageHide();
  c.link(1).blur();
  c.pageShow();
  assert.equal(document.activeElement, c.link(1));
  assert.equal(c.order()[0], '1');
  assert.equal(window.history.state[historyKey], undefined);
});

for (const inputBeforeReady of ['keydown', 'pointerdown'] as const)
  test(inputBeforeReady + ' before idle setup cancels focus restoration', t => {
    const c = carousel(t, 5, 402, { navigation: 'back_forward', target: '/article/3', inputBeforeReady });
    assert.equal(document.activeElement, document.body);
    assert.equal(c.order()[0], '0');
    assert.equal(window.history.state[historyKey], undefined);
  });

test('history restoration respects another control that already has focus', t => {
  carousel(t, 5, 402, { navigation: 'back_forward', target: '/article/3', focusBeforeReady: true });
  assert.equal(document.activeElement, document.querySelector('#outside'));
});

test('pointer activation clears a previous keyboard target without forcing focus', t => {
  const c = carousel(t);
  c.link(0).focus();
  activate(c.link(0));
  activate(c.link(1), { detail: 1 });
  assert.equal(window.history.state[historyKey], undefined);
  assert.equal(document.activeElement, c.link(0));
});

test('modified, download, new-tab and offscreen activations are not saved', t => {
  const c = carousel(t, 5, 402);
  activate(c.link(0), { ctrlKey: true });
  assert.equal(window.history.state[historyKey], undefined);
  c.link(0).target = '_blank';
  activate(c.link(0));
  assert.equal(window.history.state[historyKey], undefined);
  c.link(0).target = '';
  c.link(0).setAttribute('download', '');
  activate(c.link(0));
  assert.equal(window.history.state[historyKey], undefined);
  activate(c.link(4));
  assert.equal(window.history.state[historyKey], undefined);
});

test('a missing saved article does not move focus', t => {
  const c = carousel(t, 5, 402, { navigation: 'back_forward', target: '/article/gone' });
  assert.equal(document.activeElement, document.body);
  assert.equal(c.order()[0], '0');
  assert.equal(window.history.state[historyKey], undefined);
});

test('autoplay leaves the restored card focused until focus moves away', t => {
  const c = carousel(t, 5, 402, { navigation: 'back_forward', target: '/article/3' });
  t.mock.timers.tick(30_000);
  assert.equal(c.order()[0], '3');
  document.querySelector<HTMLButtonElement>('#outside')!.focus();
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(600);
  assert.equal(c.order()[0], '4');
});

test('history restoration cancels an unfinished autoplay slide', t => {
  const c = carousel(t);
  c.link(1).focus();
  activate(c.link(1));
  c.pageHide();
  c.link(1).blur();
  t.mock.timers.tick(10_000);
  c.pageShow();
  t.mock.timers.tick(600);
  assert.equal(c.order()[0], '1');
  assert.equal(document.activeElement, c.link(1));
});
