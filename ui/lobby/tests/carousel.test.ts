import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { makeCarousel } from '../src/view/carousel';

const cash = await import('../../../public/javascripts/vendor/cash.min.js');
Object.assign(globalThis, { $: cash.default });

function carousel(t: TestContext, count = 5, initialWidth = 612) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let resize: (() => void) | undefined;
  t.mock.method(window, 'addEventListener', (type: string, callback: () => void) => {
    if (type === 'resize') resize = callback;
  });
  document.body.innerHTML = `<div class="carousel" style="gap:18px">
    <div class="carousel__track">${Array.from({ length: count }, (_, i) => `<a>${i}</a>`).join('')}</div>
    <div class="carousel__controls"><button class="carousel__prev"></button><button class="carousel__next"></button></div>
  </div>`;
  const el = document.querySelector<HTMLElement>('.carousel')!;
  const track = el.querySelector<HTMLElement>('.carousel__track')!;
  let width = initialWidth;
  Object.defineProperty(el, 'clientWidth', { get: () => width });
  makeCarousel({ selector: '.carousel', itemWidth: 192, pauseFor: 10 });
  t.mock.timers.tick(0);
  return {
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

test('manual navigation wraps in both directions and stops autoplay until resize', t => {
  const c = carousel(t);
  c.click('prev');
  assert.deepEqual(c.order(), ['4', '0', '1', '2', '3']);
  c.click('next');
  assert.deepEqual(c.order(), ['0', '1', '2', '3', '4']);
  t.mock.timers.tick(30_000);
  assert.equal(c.order()[0], '0');
  c.resize(402);
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
