import assert from 'node:assert/strict';
import test from 'node:test';

import type { CevalCtrl } from '../src/ceval/ctrl.ts';
import { PikafishProtocol, toLocalEval, type EngineAnalysis } from '../src/ceval/engines/pikafishProtocol.ts';
import type { Work } from '../src/ceval/types.ts';

test('the ceval adapter does not publish completed analysis without a principal variation', async t => {
  let emit!: (analysis: EngineAnalysis, final: boolean) => void;
  t.mock.module(new URL('../src/ceval/engines/pikafishBrowser.ts', import.meta.url).href, {
    namedExports: {
      PikafishBrowserEngine: class {
        start(work: { emit: typeof emit }) {
          emit = work.emit;
        }
      },
    },
  });
  const { Engines } = await import('../src/ceval/engines/engines.ts');
  const engine = new Engines({ opts: { variant: { key: 'xiangqi' } } } as CevalCtrl).makeEngine();
  const received: unknown[] = [];
  engine.start({
    currentFen: 'current b - - 0 2',
    search: { depth: 18 },
    multiPv: 1,
    threads: 1,
    stopRequested: false,
    emit: value => received.push(value),
  } as Work);
  const empty: EngineAnalysis = {
    engine: 'Pikafish',
    depth: 0,
    nodes: 0,
    nps: 0,
    timeMs: 0,
    score: {},
    lines: [],
  };
  emit(empty, true);
  assert.deepEqual(received, []);
  emit(
    {
      ...empty,
      score: { redMate: 1 },
      lines: [
        {
          multipv: 1,
          depth: 18,
          seldepth: 20,
          score: { redMate: 1 },
          pvMoves: ['e10e9'],
          wxfMoves: [],
        },
      ],
    },
    true,
  );
  assert.equal(received.length, 1);
});

test('bestmove completes searches without usable info instead of leaving the caller waiting', () => {
  for (const info of [undefined, 'info depth 18 nodes 100 time 10 score mate 2 lowerbound pv e9e8']) {
    for (const bestmove of ['e9e8', '(none)', '0000']) {
      const protocol = new PikafishProtocol();
      const results: { analysis: EngineAnalysis; final: boolean }[] = [];
      protocol.connected(() => {});
      protocol.compute({
        fen: 'current b - - 0 2',
        depth: 18,
        multiPv: 1,
        threads: 1,
        hashSize: 16,
        stopRequested: false,
        emit: (analysis, final) => results.push({ analysis, final }),
      });
      if (info) protocol.received(info);
      protocol.received(`bestmove ${bestmove}`);
      assert.deepEqual(results, [
        {
          analysis: {
            engine: 'Pikafish',
            bestMove: bestmove === 'e9e8' ? 'e10e9' : undefined,
            depth: 0,
            nodes: 0,
            nps: 0,
            timeMs: 0,
            score: {},
            lines: [],
          },
          final: true,
        },
      ]);
      assert.equal(protocol.isComputing(), false);
      protocol.received(`bestmove ${bestmove}`);
      assert.equal(results.length, 1);
    }
  }
});

test('cancelled searches emit no final result with or without preceding info', () => {
  for (const withInfo of [false, true]) {
    const protocol = new PikafishProtocol();
    const commands: string[] = [];
    const finals: EngineAnalysis[] = [];
    protocol.connected(command => commands.push(command));
    protocol.compute({
      fen: 'current b - - 0 2',
      depth: 18,
      multiPv: 1,
      threads: 1,
      hashSize: 16,
      stopRequested: false,
      emit: (analysis, final) => {
        if (final) finals.push(analysis);
      },
    });
    if (withInfo) protocol.received('info depth 18 nodes 100 time 10 score mate -2 pv e9e8');
    protocol.compute();
    protocol.received('bestmove e9e8');
    assert.deepEqual(finals, []);
    assert.equal(commands.at(-1), 'stop');
    assert.equal(protocol.isComputing(), false);
  }
});

test('history search converts every move and scores from the current side to move', () => {
  const protocol = new PikafishProtocol();
  const commands: string[] = [];
  const scores: number[] = [];
  protocol.connected(command => commands.push(command));
  protocol.compute({
    fen: 'current b - - 0 2',
    history: { initialFen: 'root w - - 0 1', moves: ['h1g3', 'h10g8', 'a1a10'] },
    depth: 18,
    multiPv: 1,
    threads: 1,
    hashSize: 16,
    stopRequested: false,
    emit: analysis => scores.push(analysis.score.redMate!),
  });
  assert.ok(commands.includes('position fen root w - - 0 1 moves h0g2 h9g7 a0a9'));
  const beforeInvalidSearch = [...commands];
  assert.throws(
    () =>
      protocol.compute({
        fen: 'invalid',
        history: { initialFen: 'root', moves: ['h0g2'] },
        depth: 18,
        multiPv: 1,
        threads: 1,
        hashSize: 16,
        stopRequested: false,
        emit: () => {},
      }),
    /Invalid Xiangqi history move/,
  );
  assert.deepEqual(commands, beforeInvalidSearch);
  protocol.received('info depth 18 nodes 100 time 10 score mate -2 pv e9e8');
  protocol.received('bestmove e9e8');
  assert.deepEqual(scores, [2, 2]);
});

test('ordinary analysis keeps its FEN-only position command', () => {
  const protocol = new PikafishProtocol();
  const commands: string[] = [];
  protocol.connected(command => commands.push(command));
  protocol.compute({
    fen: 'current b - - 0 2',
    depth: 18,
    multiPv: 1,
    threads: 1,
    hashSize: 16,
    stopRequested: false,
    emit: () => {},
  });
  assert.ok(commands.includes('position fen current b - - 0 2'));
});

test('adapts Pikafish analysis to the native ceval contract', () => {
  const result = toLocalEval(
    {
      engine: 'Pikafish',
      bestMove: 'h1g3',
      depth: 18,
      nodes: 12000,
      nps: 26666,
      timeMs: 450,
      score: { cp: -42, redCp: 42 },
      lines: [
        {
          multipv: 1,
          depth: 18,
          seldepth: 24,
          score: { cp: -42, redCp: 42 },
          pvMoves: ['h1g3', 'h10g8'],
          wxfMoves: [],
        },
      ],
    },
    'xiangqi-fen',
  );

  assert.equal(result.cp, 42);
  assert.equal(result.bestmove, 'h1g3');
  assert.deepEqual(result.pvs[0].moves, ['h1g3', 'h10g8']);
});
