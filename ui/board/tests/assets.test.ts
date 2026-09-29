import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { boardAssets, validateBoardAssets } from '../src/catalog';
import { standardXiangqi, supportedBoards } from '../src/definitions';

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
  missing.pieceSets[0].variants.xiangqi.back = '';
  assert.throws(() => validateBoardAssets(missing, supportedBoards, () => true), /missing or invalid/);
  const unsafe = structuredClone(boardAssets);
  unsafe.pieceSets[0].variants.xiangqi.back = '../secrets';
  assert.throws(() => validateBoardAssets(unsafe, supportedBoards, () => true), /missing or invalid/);
});
