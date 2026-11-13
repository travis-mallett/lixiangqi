import { Resvg } from '@resvg/resvg-js';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import catalog from '../src/catalog.json';

const set = catalog.pieceSets.find(p => p.key === 'celestial-lacquer')!;
const read = (name: string) => readFileSync(new URL(`../../../public/${name}`, import.meta.url), 'utf8');

test('lacquer covers distinct kingdom generals, banners, colored backs and a neutral concealed back', () => {
  const standard = set.variants.xiangqi,
    kingdoms = set.variants.threeKingdoms;
  for (const [path, glyph] of [
    [standard.faces.red.banner, '旗'],
    [standard.faces.black.banner, '旗'],
    [kingdoms.faces.red.general, '蜀'],
    [kingdoms.faces.black.general, '魏'],
    [kingdoms.faces.green.general, '吳'],
    [kingdoms.faces.green.elephant, '向'],
    [kingdoms.faces.green.cannon, '礮'],
    [kingdoms.faces.green.soldier, '勇'],
  ])
    assert.ok(read(path).includes(`— ${glyph}</title>`), path);
  assert.equal(new Set(Object.values(kingdoms.back)).size, 3);
  assert.notEqual(read(standard.back.red), read(standard.back.black));
  assert.ok(read('piece/celestial-lacquer/Back.svg').includes('— Concealed</title>'));
});

test('every lacquer asset contains its own image, has clear gutters and solid readable faces', () => {
  const directory = new URL('../../../public/piece/celestial-lacquer/', import.meta.url);
  const files = readdirSync(directory).filter(f => f.endsWith('.svg'));
  assert.equal(files.length, 29);
  for (const file of files) {
    const source = readFileSync(new URL(file, directory), 'utf8');
    assert.match(source, /href="data:image\/png;base64,/);
    assert.doesNotMatch(source, /<text\b|<script\b|https?:\/\/(?!www.w3.org)/);
    const { pixels } = new Resvg(source, { fitTo: { mode: 'width', value: 100 } }).render();
    for (const [x, y] of [
      [0, 0],
      [50, 0],
      [99, 50],
      [50, 99],
    ])
      assert.equal(pixels[(y * 100 + x) * 4 + 3], 0, `${file}: transparent gutter`);
    for (const [x, y] of [
      [50, 50],
      [20, 50],
      [80, 50],
      [50, 80],
    ])
      assert.ok(pixels[(y * 100 + x) * 4 + 3] > 250, `${file}: opaque material`);
  }
});
