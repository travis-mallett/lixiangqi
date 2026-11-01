import { boardDefinitionForFen } from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JIEQI_START_FEN } from 'lib/game/jieqi';
import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';
import { XIANGQI_START_FEN } from 'lib/game/xiangqi';
import { createMoveTreeFromStates, type RulesState } from 'lib/tree/native';

import { analysisStartFen, bindAnalysisStartReset, useNativeReplay } from '../src/analysisVariant';

test('analysis reset uses the starting FEN for the active variant', () => {
  assert.equal(analysisStartFen(undefined), XIANGQI_START_FEN);
  assert.equal(analysisStartFen('xiangqi'), XIANGQI_START_FEN);
  assert.equal(analysisStartFen('minixiangqi'), MINI_XIANGQI_START_FEN);
  assert.equal(analysisStartFen('jieqi'), JIEQI_START_FEN);
});

test('Mini Starting Position click requests Mini FEN and retains Mini board geometry', () => {
  const button = document.createElement('button');
  let activeVariant: string | undefined = 'minixiangqi';
  let requestedFen = '';
  let loadedVariant = '';
  bindAnalysisStartReset(
    button,
    () => activeVariant,
    fen => {
      requestedFen = fen;
      loadedVariant = boardDefinitionForFen(fen).id;
      activeVariant = loadedVariant;
    },
  );

  button.click();

  assert.equal(requestedFen, MINI_XIANGQI_START_FEN);
  assert.equal(loadedVariant, 'minixiangqi');
  assert.equal(activeVariant, 'minixiangqi');
});

test('a finished-game replay keeps native moves and metadata when the URL also has a FEN', () => {
  const placement = MINI_XIANGQI_START_FEN.split(' ')[0];
  const state = (ply: number, turn: 'red' | 'black'): RulesState => ({
    variant: 'minixiangqi',
    fen: `${placement} ${turn === 'red' ? 'w' : 'b'} - - ${Math.floor(ply / 2)} ${Math.floor(ply / 2) + 1}`,
    ply,
    turn,
    legalMoves: [],
    check: false,
    gameResult: '*',
  });
  const states = [state(0, 'red'), state(1, 'black'), state(2, 'red')];
  states[0].fen = MINI_XIANGQI_START_FEN;
  const moves = ['a4a5', 'a6a5'];
  assert.equal(useNativeReplay(states, moves, false, true, true), true);
  assert.equal(useNativeReplay(states, moves, false, true, false), false);
  assert.equal(useNativeReplay(states, moves, true, false, true), false);
  const tree = createMoveTreeFromStates(states, moves, moves, [], [], 0, 'minixiangqi-v1');
  const headers = { red: 'Mini Red', black: 'Mini Black', result: '1-0', gameid: 'mini1234' };
  tree.root.metadata = headers;
  assert.equal(tree.root.state.variant, 'minixiangqi');
  assert.equal(tree.root.children[0].uci, moves[0]);
  assert.equal(tree.root.children[0].children[0].uci, moves[1]);
  assert.equal(tree.root.metadata, headers);
});
