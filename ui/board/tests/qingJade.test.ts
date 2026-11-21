import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import catalog from '../src/catalog.json';

test('Qing Jade preserves the museum inscriptions and uses self-contained vector art for every face and back', () => {
  const { xiangqi, threeKingdoms } = catalog.pieceSets.find(set => set.key === 'qing-jade')!.variants;
  const pieces = new Map<string, string | null>();
  function checkFaces(faces: Record<string, string>, characters: string) {
    const roles = ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier', 'banner'];
    [...characters].forEach((character, i) => pieces.set(faces[roles[i]], character));
  }
  checkFaces(xiangqi.faces.red, '帥士相馬車砲卒旗');
  checkFaces(xiangqi.faces.black, '將士象馬車砲兵旗');
  checkFaces(threeKingdoms.faces.red, '蜀士相馬車砲卒');
  checkFaces(threeKingdoms.faces.black, '魏士象馬車砲兵');
  checkFaces(threeKingdoms.faces.green, '吳士向馬車礮勇');
  for (const file of [
    ...Object.values(xiangqi.back),
    ...Object.values(threeKingdoms.back),
    'piece/qing-jade/Back.svg',
  ])
    pieces.set(file, null);
  assert.equal(pieces.size, 29);
  for (const [file, character] of pieces) {
    const dom = new JSDOM(readFileSync(new URL(`../../../public/${file}`, import.meta.url), 'utf8'), {
      contentType: 'image/svg+xml',
    });
    try {
      const doc = dom.window.document;
      assert.equal(doc.querySelector('image, text, foreignObject, script'), null, file);
      for (const use of doc.querySelectorAll('use')) {
        const ref = use.getAttribute('href')!;
        assert.ok(ref.startsWith('#') && doc.getElementById(ref.slice(1)), file);
      }
      assert.ok(doc.querySelector('circle[data-piece-body]'), file);
      assert.ok(doc.querySelector('#inlaid-ring path') && doc.querySelector('#polished-lip path'), file);
      assert.equal(doc.getElementById('inscription')?.getAttribute('aria-label') ?? null, character, file);
    } finally {
      dom.window.close();
    }
  }
});
