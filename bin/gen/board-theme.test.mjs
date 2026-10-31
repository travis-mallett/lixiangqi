import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { boardTheme, boardThemes } from './board-theme.mjs';

const read = name =>
  new JSDOM(readFileSync(new URL(`../../public/images/board/svg/${name}.svg`, import.meta.url), 'utf8'), {
    contentType: 'image/svg+xml',
  });
const inherited = (element, name) => {
  for (let el = element; el; el = el.parentElement) if (el.hasAttribute(name)) return el.getAttribute(name);
  return name === 'opacity' ? '1' : null;
};

for (const [index, parent] of Object.keys(boardThemes).entries()) {
  for (const variant of ['minixiangqi', 'three-player', 'banqi']) {
    test(`${parent}: ${variant} preserves parent ink and piece-relative line weight`, () => {
      const source = read(parent);
      const name =
        variant === 'banqi'
          ? `banqi-${['default', 'paper', 'tournament', 'wudang'][index]}`
          : `${parent}-${variant}`;
      const output = read(name);
      const doc = output.window.document;
      const style = boardTheme(source.window.document, parent, variant === 'banqi' ? 100 : 98);
      const grid = doc.getElementById(variant === 'minixiangqi' ? 'gridlines' : `${variant}-grid`);
      assert.equal(inherited(grid, 'stroke'), style.ink);
      assert.equal(inherited(grid, 'opacity'), style.opacity);
      assert.equal(Number(inherited(grid, 'stroke-width')), style.width);
      for (let el = grid; el; el = el.parentElement) assert.equal(el.hasAttribute('filter'), false);
      const frame = doc.getElementById(
        variant === 'minixiangqi' ? 'playing-frame' : `${variant}-playing-frame`,
      );
      assert.equal(Boolean(frame), Boolean(style.frame));
      if (frame) {
        assert.equal(Number(inherited(frame, 'stroke-width')), style.frame.width);
        assert.equal(inherited(frame, 'stroke'), style.frame.ink);
      }
      source.window.close();
      output.window.close();
    });
  }
}
