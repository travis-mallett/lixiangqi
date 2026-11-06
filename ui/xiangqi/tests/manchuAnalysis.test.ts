import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createXiangqiBoard, xiangqiPosition } from 'lib/board';
import { PikafishProtocol, engineMoveToUi, type EngineAnalysis } from 'lib/ceval/engines/pikafishProtocol';
import { MANCHU_START_FEN, manchuEngineFen } from 'lib/game/manchu';
import type { RulesState } from 'lib/game/xiangqiNotation';
import { xiangqiPremoveTargets } from 'lib/game/xiangqiPremove';
import { createMoveTree } from 'lib/tree/native';
import { renderTreeNotation } from 'lib/tree/notation';

import { analysisEngineConfig } from '../src/analysisEngineConfig';
import { analysisStartFen } from '../src/analysisVariant';

test('Manchu analysis reset, engine and notation preserve native identity', () => {
  assert.equal(analysisStartFen('manchu'), MANCHU_START_FEN);
  const config = analysisEngineConfig('manchu');
  assert.equal(config.variant, 'manchu');
  assert.equal(config.name, 'Fairy-Stockfish');
  assert.deepEqual(config.hiddenSettings, ['use-cloud']);
  const tree = createMoveTree({
    fen: MANCHU_START_FEN,
    variant: 'manchu',
    ply: 0,
    turn: 'red',
    legalMoves: [],
    check: false,
    gameResult: '*',
  } satisfies RulesState);
  assert.equal(tree.root.ruleset, 'manchu-v1');
  assert.match(renderTreeNotation(tree.root), /\[Variant "Manchu\+"\]/);
});

test('Manchu engine sends ordinary FEN with one-based ranks in history, restrictions, PV and bestmove', () => {
  const commands: string[] = [];
  let result: EngineAnalysis | undefined;
  const protocol = new PikafishProtocol(undefined, undefined, undefined, 'manchu');
  protocol.connected(command => commands.push(command));
  protocol.received('uciok');
  assert.ok(commands.includes('setoption name UCI_Variant value manchu'));
  assert.ok(commands.includes('setoption name Use NNUE value false'));
  protocol.received('readyok');
  protocol.compute({
    fen: MANCHU_START_FEN,
    history: { initialFen: MANCHU_START_FEN, moves: ['a4a5'], ruleset: 'manchu-v1' },
    legalMoves: ['a10b8'],
    search: { depth: 2 },
    multiPv: 1,
    threads: 1,
    hashSize: 16,
    stopRequested: false,
    emit: analysis => {
      result = analysis;
    },
  });
  assert.ok(commands.includes(`position fen ${manchuEngineFen(MANCHU_START_FEN)} moves a4a5`));
  assert.equal(commands.at(-1), 'go depth 2 searchmoves a10b8');
  protocol.received('info depth 2 score cp 12 nodes 50 time 10 pv a10b8 b3b10');
  protocol.received('bestmove a10b8');
  assert.equal(result?.bestMove, 'a10b8');
  assert.deepEqual(result?.lines[0].pvMoves, ['a10b8', 'b3b10']);
  assert.equal(engineMoveToUi('a0a1', 'manchu'), undefined);
  assert.equal(engineMoveToUi('a9b7', 'xiangqi'), 'a10b8');
  protocol.disconnected();
});

test('the shared board renders the Banner and its premoves in either orientation', () => {
  const position = xiangqiPosition(MANCHU_START_FEN);
  assert.equal(position.pieces.size, 28);
  assert.equal(position.pieces.get('a10')?.face, 'up');
  const targets = xiangqiPremoveTargets(position, 'a10');
  for (const square of ['a1', 'i10', 'b8', 'c9']) assert.ok(targets.includes(square));
  assert.ok(!targets.includes('b9'));
  for (const perspective of ['red', 'black']) {
    const element = document.createElement('div');
    document.body.append(element);
    const board = createXiangqiBoard(element, position);
    board.setPresentation({ ...board.getPresentation(), perspective });
    assert.equal(board.getDefinition().id, 'manchu');
    assert.ok(element.querySelector('piece.m-piece.black'));
    board.destroy();
    element.remove();
  }
  const captured = xiangqiPosition('4k4/9/9/9/4p4/9/9/9/R8/4K4 b m - 0 1');
  assert.equal(captured.board, 'manchu');
});
