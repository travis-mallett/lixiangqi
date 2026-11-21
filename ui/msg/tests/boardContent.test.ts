import assert from 'node:assert/strict';
import test from 'node:test';

import { boardFileKind, boardSources } from '../src/boardContent';

test('recognizes a full game link in a caption and rejects a partial player suffix', () => {
  const link = 'https://lixiangqi.com/Ab123456Cd78';
  assert.deepEqual(boardSources(`Replay ${link} here`), [{ kind: 'link', value: link, inline: true }]);
  assert.deepEqual(boardSources(link.slice(0, -1)), []);
});

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

test('recognizes all duel position formats and the public Three Kingdoms game route', () => {
  for (const value of [
    'rcnkncr/p1ppp1p/7/7/7/P1PPP1P/RCNKNCR w - - 0 1',
    '5k3/9/9/9/9/2B6/9/2B6/9/2X1K4 w j - 0 1',
    '4k4/9/9/9/4p4/9/9/9/M8/4K4 w m - 0 1',
  ])
    assert.deepEqual(boardSources(`Position: ${value} here`), [{ kind: 'fen', value, inline: true }]);
  const value = 'https://lixiangqi.com/three-kingdoms/game/sO7KUrjr';
  assert.deepEqual(boardSources(value + '\u00a0'), [{ kind: 'link', value, inline: true }]);
  assert.equal(boardFileKind('three-kingdoms-sO7KUrjr.json'), 'record');
});
