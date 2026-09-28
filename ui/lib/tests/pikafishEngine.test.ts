import assert from 'node:assert/strict';
import test from 'node:test';

import type { CevalCtrl } from '../src/ceval/ctrl.ts';
import { PikafishProtocol, toLocalEval, type EngineAnalysis } from '../src/ceval/engines/pikafishProtocol.ts';
import type { Work } from '../src/ceval/types.ts';

test('queued work cannot search before native startup acknowledges configured options', () => {
  const commands: string[] = [];
  let ready = false;
  const protocol = new PikafishProtocol(
    () => {},
    () => {
      ready = true;
    },
    { threads: 4, hashSize: 32 },
  );
  protocol.connected(command => commands.push(command));
  const work = {
    fen: 'current w - - 0 1',
    search: { depth: 18 },
    multiPv: 1,
    threads: 4,
    hashSize: 32,
    stopRequested: false,
    emit() {},
  };
  protocol.compute(work);
  assert.deepEqual(commands, ['uci']);
  protocol.received('uciok');
  protocol.compute(work);
  assert.equal(ready, false);
  assert.deepEqual(commands, [
    'uci',
    'setoption name Threads value 4',
    'setoption name Hash value 32',
    'ucinewgame',
    'isready',
  ]);
  protocol.received('readyok');
  assert.equal(ready, true);
  assert.equal(commands.at(-1), 'go depth 18');
  protocol.disconnected();
  const count = commands.length;
  protocol.compute(work);
  assert.equal(commands.length, count);
});

test('adaptive search spends four seconds searching, then deepens the same search for two more', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const commands: string[] = [];
  const results: EngineAnalysis[] = [];
  const protocol = new PikafishProtocol();
  protocol.connected(command => commands.push(command));
  protocol.received('uciok');
  protocol.received('readyok');
  protocol.compute({
    fen: 'current b - - 0 2',
    search: {
      movetime: 4000,
      extension: {
        minMovetime: 2000,
        maxMovetime: 2000,
        needed: analysis => analysis.score.redMate === undefined,
        complete: () => true,
      },
    },
    multiPv: 1,
    threads: 1,
    hashSize: 16,
    stopRequested: false,
    emit(analysis, final) {
      if (final) results.push(analysis);
    },
  });
  assert.equal(commands.at(-1), 'go infinite');
  t.mock.timers.tick(5000);
  assert.equal(commands.at(-1), 'go infinite', 'startup time must not consume the search budget');
  protocol.received('info depth 25 nodes 100 time 100 score cp 800 pv e9e8');
  t.mock.timers.tick(3899);
  assert.equal(commands.at(-1), 'go infinite');
  t.mock.timers.tick(1);
  assert.equal(commands.at(-1), 'go infinite', 'even depth 25 adverse results get more search');
  protocol.received('info depth 28 nodes 500 time 5500 score mate -6 pv e9e8');
  t.mock.timers.tick(1999);
  assert.equal(commands.at(-1), 'go infinite');
  t.mock.timers.tick(1);
  assert.equal(commands.at(-1), 'stop');
  protocol.received('bestmove e9e8');
  assert.equal(results[0].depth, 28);
  assert.equal(results[0].score.redMate, 6);
  assert.equal(commands.filter(c => c.startsWith('go ')).length, 1);
});

test('acceptable adaptive search stops at four seconds and cancellation clears its timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const commands: string[] = [];
  const protocol = new PikafishProtocol();
  protocol.connected(c => commands.push(c));
  protocol.received('uciok');
  protocol.received('readyok');
  const start = () =>
    protocol.compute({
      fen: 'current b - - 0 2',
      search: {
        movetime: 4000,
        extension: { minMovetime: 2000, maxMovetime: 2000, needed: () => false, complete: () => true },
      },
      multiPv: 1,
      threads: 1,
      hashSize: 16,
      stopRequested: false,
      emit() {},
    });
  start();
  protocol.received('info depth 10 nodes 100 time 100 score mate -2 pv e9e8');
  t.mock.timers.tick(3899);
  assert.equal(commands.at(-1), 'go infinite');
  t.mock.timers.tick(1);
  assert.equal(commands.at(-1), 'stop');
  protocol.received('bestmove e9e8');
  start();
  protocol.received('info depth 10 nodes 100 time 100 score mate -2 pv e9e8');
  protocol.compute();
  const count = commands.length;
  t.mock.timers.tick(10000);
  assert.equal(commands.length, count);
});

test('extended confirmation stops on depth, a rescued score, or the total fifteen-second limit', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const finish of ['depth', 'rescued', 'limit', 'cancelled'] as const) {
    const commands: string[] = [];
    const protocol = new PikafishProtocol();
    protocol.connected(c => commands.push(c));
    protocol.received('uciok');
    protocol.received('readyok');
    protocol.compute({
      fen: 'current b - - 0 2',
      search: {
        movetime: 4000,
        extension: {
          minMovetime: 2000,
          maxMovetime: 11000,
          needed: () => true,
          complete: a => a.depth >= 20 || a.score.redMate === 6,
        },
      },
      multiPv: 1,
      threads: 1,
      hashSize: 16,
      stopRequested: false,
      emit() {},
    });
    protocol.received('info depth 15 nodes 100 time 100 score cp 900 pv e9f9');
    t.mock.timers.tick(3900);
    t.mock.timers.tick(2000);
    assert.equal(commands.at(-1), 'go infinite', 'shallow failure is not stopped at six seconds');
    if (finish === 'depth' || finish === 'rescued') {
      t.mock.timers.tick(1000);
      protocol.received(
        finish === 'depth'
          ? 'info depth 20 nodes 800 time 7000 score cp 900 pv e9f9'
          : 'info depth 19 nodes 800 time 7000 score mate -6 pv e9f9',
      );
      assert.equal(commands.at(-1), 'stop');
      protocol.received('bestmove e9f9');
    } else if (finish === 'limit') {
      t.mock.timers.tick(8999);
      assert.equal(commands.at(-1), 'go infinite');
      t.mock.timers.tick(1);
      assert.equal(commands.at(-1), 'stop');
      protocol.received('bestmove e9f9');
    } else {
      protocol.compute();
      assert.equal(commands.at(-1), 'stop');
    }
    const count = commands.length;
    t.mock.timers.tick(20000);
    assert.equal(commands.length, count, 'no late confirmation timer survives completion or cancellation');
    assert.equal(commands.filter(c => c.startsWith('go ')).length, 1);
  }
});

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
      protocol.received('uciok');
      protocol.received('readyok');
      protocol.compute({
        fen: 'current b - - 0 2',
        search: { depth: 18 },
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
    protocol.received('uciok');
    protocol.received('readyok');
    protocol.compute({
      fen: 'current b - - 0 2',
      search: { depth: 18 },
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
  protocol.received('uciok');
  protocol.received('readyok');
  protocol.compute({
    fen: 'current b - - 0 2',
    history: { initialFen: 'root w - - 0 1', moves: ['h1g3', 'h10g8', 'a1a10'] },
    search: { depth: 18 },
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
        search: { depth: 18 },
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
  protocol.received('uciok');
  protocol.received('readyok');
  protocol.compute({
    fen: 'current b - - 0 2',
    search: { depth: 18 },
    multiPv: 1,
    threads: 1,
    hashSize: 16,
    stopRequested: false,
    emit: () => {},
  });
  assert.ok(commands.includes('position fen current b - - 0 2'));
  assert.ok(commands.includes('go depth 18'));
});

test('timed searches complete normally with the final evaluation and best move', () => {
  const protocol = new PikafishProtocol();
  const commands: string[] = [];
  const results: { analysis: EngineAnalysis; final: boolean }[] = [];
  protocol.connected(command => commands.push(command));
  protocol.received('uciok');
  protocol.received('readyok');
  protocol.compute({
    fen: 'current w - - 0 2',
    search: { movetime: 3000 },
    multiPv: 1,
    threads: 1,
    hashSize: 16,
    stopRequested: false,
    emit: (analysis, final) => results.push({ analysis, final }),
  });
  assert.deepEqual(
    commands.filter(command => command.startsWith('go ')),
    ['go movetime 3000'],
  );
  protocol.received('info depth 14 nodes 100 time 3000 score cp 800 pv a0a1');
  protocol.received('bestmove a0a1');
  assert.equal(results.length, 2);
  assert.equal(results[1].final, true);
  assert.equal(results[1].analysis.bestMove, 'a1a2');
  assert.equal(results[1].analysis.score.redCp, 800);
  assert.equal(results[1].analysis.depth, 14);
  assert.equal(protocol.isComputing(), false);
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
