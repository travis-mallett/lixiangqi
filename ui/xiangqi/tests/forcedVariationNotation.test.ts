import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { XIANGQI_START_FEN } from 'lib/game/xiangqi';
import { renderNodesTxt, renderTreeNotation } from 'lib/tree/notation';

import { forcedVariationFixture } from './forcedVariationFixture';
import { fixtureTree } from './treeFixtures';

const fixture = new URL('../../../modules/xiangqi/src/test/resources/forced-variations.pgn', import.meta.url);

test('browser forced-only export matches the fixture imported by the native server', () => {
  const tree = forcedVariationFixture();
  const before = JSON.stringify(tree.root);
  assert.equal(renderTreeNotation(tree.root), readFileSync(fixture, 'utf8').trim());
  assert.equal(JSON.stringify(tree.root), before);
  assert.equal(tree.pathIsMainline('a4a5'), false);
  assert.equal(tree.pathIsMainline('i4i5'), false);
});

test('structural order and document result stay independent of the semantic main line', () => {
  const tree = forcedVariationFixture();
  tree.root.children[1].forceVariation = false;
  const text = renderTreeNotation(tree.root);
  assert.ok(text.indexOf('1. a4a5') < text.indexOf('(1. i4i5'));
  assert.ok(text.endsWith('0-1'));
  assert.equal(tree.pathIsMainline('i4i5'), true);
});

test('single forced move, custom black start and explicit ongoing node result stay exportable', () => {
  const tree = fixtureTree(XIANGQI_START_FEN.replace('w - - 0 1', 'b - - 0 20'), ['a7a6']);
  tree.root.children[0].forceVariation = true;
  tree.root.children[0].result = '*';
  const text = renderTreeNotation(tree.root);
  assert.match(text, /\n\n20\.\.\. a7a6/);
  assert.ok(text.includes('[%nodeResult *]'));
  assert.ok(text.endsWith('*'));
});

test('omitting optional comments still preserves node results without making them document results', () => {
  const tree = forcedVariationFixture();
  const text = renderNodesTxt(tree.root, true);
  assert.ok(text.includes('[%nodeResult 1-0]'));
  assert.ok(text.includes('[%nodeResult 1/2-1/2]'));
  assert.equal(text.includes('[%comment'), false);
  delete tree.root.metadata;
  assert.ok(renderTreeNotation(tree.root).endsWith('*'));
});
