import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createXiangqiBoard, xiangqiPosition } from 'lib/board';
import { PikafishProtocol, parsePikafishInfo, type EngineAnalysis } from 'lib/ceval/engines/pikafishProtocol';
import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';
import { xiangqiPremoveTargets } from 'lib/game/xiangqiPremove';

import { analysisEngineConfig } from '../src/analysisEngineConfig';
import { engineSettingsKey, loadEngineSettings } from '../src/analysisSettings';

test('analysis selects the Mini engine and independently persists its settings', () => {
  localStorage.clear();
  localStorage.setItem(engineSettingsKey('minixiangqi'), JSON.stringify({ depth: 15 }));
  assert.equal(loadEngineSettings('minixiangqi').depth, 15);
  assert.equal(loadEngineSettings('jieqi').depth, 20);
  assert.equal(loadEngineSettings('xiangqi').depth, 20);
  const config = analysisEngineConfig('minixiangqi');
  assert.equal(config.variant, 'minixiangqi');
  assert.equal(config.name, 'Fairy-Stockfish');
  assert.equal(config.candidateMoves, false);
  assert.deepEqual(config.hiddenSettings, ['use-cloud']);
  localStorage.clear();
});

test('Mini UCI uses one-based coordinates for history, legal restrictions, PV and bestmove', () => {
  const commands: string[] = [];
  let result: EngineAnalysis | undefined;
  const protocol = new PikafishProtocol(undefined, undefined, undefined, 'minixiangqi');
  protocol.connected(command => commands.push(command));
  protocol.received('uciok');
  assert.ok(commands.includes('setoption name UCI_Variant value minixiangqi'));
  assert.ok(commands.includes('setoption name Use NNUE value false'));
  protocol.received('readyok');
  protocol.compute({
    fen: MINI_XIANGQI_START_FEN,
    history: { initialFen: MINI_XIANGQI_START_FEN, moves: ['a2a3'], ruleset: 'minixiangqi-v1' },
    legalMoves: ['g6f6'],
    search: { depth: 2 },
    multiPv: 1,
    threads: 1,
    hashSize: 16,
    stopRequested: false,
    emit: analysis => {
      result = analysis;
    },
  });
  assert.ok(commands.includes(`position fen ${MINI_XIANGQI_START_FEN} moves a2a3`));
  assert.equal(commands.at(-1), 'go depth 2 searchmoves g6f6');
  protocol.received('info depth 2 score cp 12 nodes 50 time 10 pv g6f6 a3a4');
  protocol.received('bestmove g6f6');
  assert.equal(result?.bestMove, 'g6f6');
  assert.deepEqual(result?.lines[0].pvMoves, ['g6f6', 'a3a4']);
  assert.equal(
    parsePikafishInfo(
      'info depth 2 score cp 12 nodes 50 time 10 pv h9h8',
      MINI_XIANGQI_START_FEN,
      'minixiangqi',
    ),
    undefined,
  );
  protocol.disconnected();
});

test('the shared board boundary and premoves use Mini geometry in either orientation', () => {
  const position = xiangqiPosition(MINI_XIANGQI_START_FEN);
  assert.ok(xiangqiPremoveTargets(position, 'a2').includes('b2'));
  assert.ok(
    !xiangqiPremoveTargets(position, 'g1').some(square => square.startsWith('h') || square.endsWith('8')),
  );
  for (const perspective of ['red', 'black']) {
    const frame = document.createElement('div');
    frame.className = 'main-board xiangqi9x10';
    const element = document.createElement('div');
    frame.append(element);
    document.body.append(frame);
    const board = createXiangqiBoard(element, position);
    board.setPresentation({ ...board.getPresentation(), perspective });
    assert.equal(board.getDefinition().id, 'minixiangqi');
    assert.equal(board.position().pieces.size, 24);
    assert.equal(element.dataset.boardDefinition, 'minixiangqi');
    assert.equal(frame.style.getPropertyValue('--board-aspect-ratio'), '1');
    board.destroy();
    frame.remove();
  }
});
