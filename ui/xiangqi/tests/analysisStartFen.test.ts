import { boardDefinitionForFen } from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JIEQI_START_FEN } from 'lib/game/jieqi';
import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';
import { XIANGQI_START_FEN } from 'lib/game/xiangqi';

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
  const states = [{ fen: MINI_XIANGQI_START_FEN, headers: { result: '1-0' } }, { fen: 'next' }];
  const moves = ['a4a5'];
  assert.equal(useNativeReplay(states, moves, false, true, true), true);
  assert.equal(useNativeReplay(states, moves, false, true, false), false);
  assert.equal(useNativeReplay(states, moves, true, false, true), false);
});
