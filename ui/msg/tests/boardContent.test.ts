import assert from 'node:assert/strict';
import test from 'node:test';

import { boardFileKind, boardSources } from '../src/boardContent';

test('detects a FEN and puzzle URL alongside prose without mistaking other domains for LiXiangQi', () => {
  const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  const link = 'https://lixiangqi.com/training/Ab123';
  assert.deepEqual(boardSources(`Position: ${fen}\nPuzzle: ${link} and https://example.net/training/Ab123`), [
    { kind: 'fen', value: fen, inline: true },
    { kind: 'link', value: link, inline: true },
  ]);
  assert.equal(boardFileKind('diagram.FEN'), 'fen');
  assert.equal(boardFileKind('replay.pgn'), 'pgn');
});

test('separates pasted PGN from a caption before and after the game', () => {
  const pgn = '[Event "Inbox"]\n\n1. h3e3 h8e8 *';
  assert.deepEqual(boardSources(`The game\n${pgn}\nA follow-up`), [
    { kind: 'pgn', value: pgn, inline: true },
  ]);
});
