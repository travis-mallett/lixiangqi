import assert from 'node:assert/strict';
import test from 'node:test';

import { JIEQI_START_FEN } from 'lib/game/jieqi';
import { createMoveTree, createMoveTreeFromStates } from 'lib/tree/native';
import { renderTreeNotation } from 'lib/tree/notation';

import type AnalyseCtrl from '../../analyse/src/ctrl';
import { renderFullTxt, renderVariationNotation } from '../../analyse/src/notationExport';

test('browser copy and variation exports preserve legacy pawn coordinates and reveals', () => {
  // fPL0UJju at ply 21, replayed from the authoritative coordinate/reveal fixture.
  // Only the two relevant legal candidates are needed by this export test.
  const tree = createMoveTreeFromStates(
    [
      {
        variant: 'jieqi',
        fen: '3xkx1R1/c2p5/4a3a/4x3x/npb6/B8/2X1X3X/1XP1P2X1/9/X1XXKX2X w j - 5 11',
        ply: 20,
        turn: 'red',
        legalMoves: ['c4c5', 'e4e5'],
        check: false,
        gameResult: '*',
      },
      {
        variant: 'jieqi',
        fen: '3xkx1R1/c2p5/4a3a/4x3x/npb6/B1C6/4X3X/1XP1P2X1/9/X1XXKX2X b j - 6 11',
        ply: 21,
        turn: 'black',
        legalMoves: [],
        check: false,
        gameResult: '*',
        reveal: 'cannon',
      },
    ],
    ['c4c5'],
    ['+P+1'],
    ['前兵进一'],
    [],
    0,
    'jieqi-v1',
  );
  const ctrl = { tree } as AnalyseCtrl;
  for (const text of [renderFullTxt(ctrl), renderVariationNotation([tree.root, tree.root.children[0]])]) {
    assert.match(text, /11\. c4c5~cannon/);
    assert.ok(!text.includes('+P+1'));
  }
  tree.root.children[0].uci = 'e4e5';
  assert.throws(() => renderFullTxt(ctrl), /identity/);
  tree.root.children[0].id = 'e4e5~cannon';
  assert.throws(() => renderFullTxt(ctrl), /recorded.*position/);
  assert.throws(() => renderVariationNotation([tree.root, tree.root.children[0]]), /recorded.*position/);
  tree.root.children[0].uci = 'c4c5';
  tree.root.children[0].id = 'c4c5~chariot';
  tree.root.children[0].state.reveal = 'chariot';
  assert.throws(() => renderFullTxt(ctrl), /recorded.*position/);
});

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
