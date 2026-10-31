import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { boardAssets, validateBoardAssets } from '../src/catalog';
import { standardXiangqi, supportedBoards } from '../src/definitions';

test('all piece faces and backs have a 100-unit canvas and a centered 90-unit body', () => {
  for (const set of boardAssets.pieceSets)
    for (const variant of Object.values(set.variants)) {
      for (const path of [
        ...Object.values(variant.back),
        ...Object.values(variant.faces).flatMap(Object.values),
      ]) {
        const svg = readFileSync(new URL(`../../../public/${path}`, import.meta.url), 'utf8');
        const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
        try {
          const root = dom.window.document.documentElement;
          assert.equal(root.getAttribute('viewBox'), '0 0 100 100', path);
          assert.equal(root.getAttribute('width'), '100', path);
          assert.equal(root.getAttribute('height'), '100', path);
          const body = root.querySelector('[data-piece-body]');
          assert.ok(body, path);
          // Measure the body and its outline, excluding decorative ink filters.
          body.setAttribute('fill', 'black');
          body.removeAttribute('filter');
          let node = body;
          while (node !== root) {
            const parent = node.parentElement!;
            // Snapshot the live collection before removing siblings.
            const siblings = Array.from(parent.children);
            for (const sibling of siblings) if (sibling !== node) sibling.remove();
            node = parent;
          }
          const bounds = new Resvg(root.outerHTML, { font: { loadSystemFonts: false } }).getBBox()!;
          // resvg uses single-precision floats internally.
          for (const [actual, expected] of [
            [bounds.x, 5],
            [bounds.y, 5],
            [bounds.width, 90],
            [bounds.height, 90],
          ])
            assert.ok(Math.abs(actual - expected) < 0.0001, `${path}: ${actual} != ${expected}`);
        } finally {
          dom.window.close();
        }
      }
    }
});

test('the catalog covers all supported geometry, pieces, backs and effects with real files', () => {
  validateBoardAssets(boardAssets, supportedBoards, path =>
    existsSync(fileURLToPath(new URL(`../../../public/${path}`, import.meta.url))),
  );
});

test('adding a variant or omitting a concealed face fails theme acceptance', () => {
  assert.throws(
    () => validateBoardAssets(boardAssets, [{ ...standardXiangqi, id: 'test-variant' }], () => true),
    /does not cover/,
  );
  const missing = structuredClone(boardAssets);
  missing.pieceSets[0].variants.xiangqi.back.red = '';
  assert.throws(() => validateBoardAssets(missing, supportedBoards, () => true), /missing or invalid/);
  const unsafe = structuredClone(boardAssets);
  unsafe.pieceSets[0].variants.xiangqi.back.black = '../secrets';
  assert.throws(() => validateBoardAssets(unsafe, supportedBoards, () => true), /missing or invalid/);
});

test('paper backs preserve the matching face body and contain no symbol', () => {
  for (const key of ['xiangqi-paper-traditional', 'xiangqi-international']) {
    const variant = boardAssets.pieceSets.find(set => set.key === key)!.variants.xiangqi;
    assert.notEqual(variant.back.red, variant.back.black);
    for (const color of ['red', 'black']) {
      const read = (path: string) =>
        readFileSync(new URL(`../../../public/${path}`, import.meta.url), 'utf8');
      const face = read(variant.faces[color].soldier);
      const back = read(variant.back[color]);
      assert.equal(back.match(/<circle[^>]+\/>/)?.[0], face.match(/<circle[^>]+\/>/)?.[0]);
      assert.equal(back.match(/transform="[^"]+"/)?.[0], face.match(/transform="[^"]+"/)?.[0]);
      assert.ok(!/<(?:path|text)\b/.test(back));
    }
  }
});
