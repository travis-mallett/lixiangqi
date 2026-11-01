import assert from 'node:assert/strict';
import test from 'node:test';

import { JIEQI_START_FEN } from 'lib/game/jieqi';
import { createMoveTree } from 'lib/tree/native';
import { renderTreeNotation } from 'lib/tree/notation';

test('export emits case-insensitively unique authoritative headers and the recorded result', () => {
  const tree = createMoveTree({
    variant: 'jieqi',
    fen: JIEQI_START_FEN,
    ply: 0,
    turn: 'red',
    legalMoves: [],
    check: false,
    gameResult: '*',
  });
  tree.root.metadata = {
    variant: 'Jieqi',
    Variant: 'Jieqi',
    fen: JIEQI_START_FEN,
    setup: '1',
    ruleset: 'jieqi-v1',
    result: '0-1',
    red: 'Named player',
    black: 'Pikafish level 1',
  };
  const text = renderTreeNotation(tree.root);
  const names = [...text.matchAll(/^\[(\w+) /gm)].map(match => match[1].toLowerCase());
  assert.equal(new Set(names).size, names.length);
  assert.match(text, /\[Result "0-1"\]/);
  assert.match(text, /\[Red "Named player"\]/);
  assert.match(text, /\n\n\s*0-1$/);
});

test('header line endings use the canonical native escapes without losing literal backslashes', () => {
  const tree = createMoveTree({
    variant: 'jieqi',
    fen: JIEQI_START_FEN,
    ply: 0,
    turn: 'red',
    legalMoves: [],
    check: false,
    gameResult: '*',
  });
  const value = '象棋\nline\r\nnext\rlast \\n \\r "quote" \\';
  tree.root.metadata = { ChapterDescription: value };
  const text = renderTreeNotation(tree.root);
  assert.equal(
    text.split('\n').find(line => line.startsWith('[chapterdescription ')),
    String.raw`[chapterdescription "象棋\nline\r\nnext\rlast \\n \\r \"quote\" \\"]`,
  );
  assert.equal(text.includes('\r'), false);
  for (const value of ['', 'Legacy single line', '象棋', '\\n', '\\r']) {
    tree.root.metadata = { ChapterDescription: value };
    assert.ok(renderTreeNotation(tree.root).includes(`[chapterdescription ${JSON.stringify(value)}]`));
  }
});
