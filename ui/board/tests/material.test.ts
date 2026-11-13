import { Resvg } from '@resvg/resvg-js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import catalog from '../src/catalog.json';
import { sidewallColors, sidewallMaterial } from '../src/motion/material';

const read = (path: string) => readFileSync(new URL(`../../../public/${path}`, import.meta.url));
const profile = (path: string, size = 256) => {
  const pixels = new Resvg(read(path), {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  }).render().pixels;
  return sidewallColors(new Uint8ClampedArray(pixels), size);
};

test('every released face and back supplies a solid sidewall with a padded round silhouette', () => {
  for (const set of catalog.pieceSets)
    for (const path of new Set(
      Object.values(set.variants).flatMap(v => [
        ...Object.values(v.faces).flatMap(roles => Object.values(roles)),
        ...Object.values(v.back),
      ]),
    )) {
      // Native snapshots use 384 px; textured outlines must resolve there too.
      assert.equal(profile(path, 384).length, 33);
      const { image } = sidewallMaterial(profile(path));
      const svg = decodeURIComponent(image.slice('url("data:image/svg+xml,'.length, -2));
      const { pixels } = new Resvg(svg, {
        fitTo: { mode: 'width', value: 400 },
        font: { loadSystemFonts: false },
      }).render();
      for (const [x, y] of [
        [200, 375],
        [100, 340],
        [300, 340],
      ])
        assert.equal(pixels[(y * 400 + x) * 4 + 3], 255, `${path}: opaque body at ${x},${y}`);
      for (const [x, y] of [
        [200, 383],
        [100, 360],
        [300, 360],
      ])
        assert.equal(pixels[(y * 400 + x) * 4 + 3], 0, `${path}: rounded lower contour at ${x},${y}`);
    }
});

test('wood sidewalls retain the actual bevel lighting, independently of the inscription', () => {
  const paths = ['default-wood/rK.svg', 'default-wood/bR.svg', 'xiangqi-western/rN.svg'];
  const colors = paths.map(p => profile(`piece/${p}`));
  assert.deepEqual(colors[0], colors[1]);
  assert.deepEqual(colors[0], colors[2]);
  assert.ok(new Set(colors[0]).size > 10, 'preserve the wood lighting and grain instead of a uniform band');
});
