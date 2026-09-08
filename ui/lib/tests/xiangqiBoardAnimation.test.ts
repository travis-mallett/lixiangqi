import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  findPrimaryXiangqiBoard,
  playXiangqiBoardAnimation,
  preloadXiangqiBoardAnimations,
  stopXiangqiBoardAnimation,
} from '../src/xiangqiBoardAnimation';

const originalMatchMedia = window.matchMedia;

function board(width: number, height: number, classes = ''): HTMLElement {
  const element = document.createElement('div');
  element.className = `cg-wrap xiangqi9x10 ${classes}`;
  element.getBoundingClientRect = () => ({ width, height }) as DOMRect;
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.body.dataset.boardAnimations;
  document.head.querySelectorAll('[data-xiangqi-board-animation]').forEach(element => element.remove());
  window.matchMedia = originalMatchMedia;
});

test('preloads each web asset once per document', () => {
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });

  preloadXiangqiBoardAnimations();
  preloadXiangqiBoardAnimations();

  const links = document.head.querySelectorAll<HTMLLinkElement>('[data-xiangqi-board-animation]');
  assert.equal(links.length, 3);
  assert.equal(links[0].rel, 'preload');
  assert.equal(links[0].as, 'image');
  assert.match(links[0].href, /board-animations\/lixiangqi-default\/capture\/animation\.webp$/);
  assert.match(links[1].href, /board-animations\/lixiangqi-default\/check\/animation\.webp$/);
  assert.match(links[2].href, /board-animations\/lixiangqi-default\/checkmate\/animation\.webp$/);
});

test('plays on the largest visible non-mini Xiangqi board and restarts cleanly', () => {
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });
  board(180, 200, 'mini-board');
  const smaller = board(360, 400);
  const primary = board(720, 800);

  assert.equal(findPrimaryXiangqiBoard(), primary);
  playXiangqiBoardAnimation('check');

  const first = primary.querySelector<HTMLImageElement>('.xiangqi-board-animation__image');
  assert.ok(first);
  assert.match(first.src, /board-animations\/lixiangqi-default\/check\/animation\.webp#1$/);
  assert.equal(smaller.querySelector('.xiangqi-board-animation'), null);

  playXiangqiBoardAnimation('capture');
  const second = primary.querySelector<HTMLImageElement>('.xiangqi-board-animation__image');
  assert.ok(second);
  assert.notEqual(second, first);
  assert.notEqual(second.src, first.src);
  assert.match(second.src, /board-animations\/lixiangqi-default\/capture\/animation\.webp#2$/);
  assert.equal(primary.querySelectorAll('.xiangqi-board-animation').length, 1);

  playXiangqiBoardAnimation('checkmate');
  const third = primary.querySelector<HTMLImageElement>('.xiangqi-board-animation__image');
  assert.ok(third);
  assert.notEqual(third, second);
  assert.match(third.src, /board-animations\/lixiangqi-default\/checkmate\/animation\.webp#3$/);
  assert.ok(third.closest('.xiangqi-board-animation--checkmate'));
  assert.equal(primary.querySelectorAll('.xiangqi-board-animation').length, 1);

  stopXiangqiBoardAnimation(primary);
  assert.equal(primary.querySelector('.xiangqi-board-animation'), null);
});

test('does not play when reduced motion is requested', () => {
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });
  const primary = board(720, 800);
  window.matchMedia = () => ({ matches: true }) as MediaQueryList;

  playXiangqiBoardAnimation('capture', primary);

  assert.equal(primary.querySelector('.xiangqi-board-animation'), null);
});

test('only preloads and plays animations selected by the display preference', () => {
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });
  const primary = board(720, 800);
  document.body.dataset.boardAnimations = String(16 | 4 | 8);

  preloadXiangqiBoardAnimations();
  const preloads = [...document.head.querySelectorAll<HTMLLinkElement>('[data-xiangqi-board-animation]')];
  assert.deepEqual(
    preloads.map(link => link.getAttribute('data-xiangqi-board-animation')),
    ['check', 'checkmate'],
  );

  playXiangqiBoardAnimation('capture', primary);
  assert.equal(primary.querySelector('.xiangqi-board-animation'), null);

  playXiangqiBoardAnimation('check', primary);
  assert.ok(primary.querySelector('.xiangqi-board-animation--check'));
});

test('off disables every board event animation', () => {
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });
  const primary = board(720, 800);
  document.body.dataset.boardAnimations = '0';

  playXiangqiBoardAnimation('capture', primary);
  playXiangqiBoardAnimation('check', primary);
  playXiangqiBoardAnimation('checkmate', primary);

  assert.equal(primary.querySelector('.xiangqi-board-animation'), null);
});
