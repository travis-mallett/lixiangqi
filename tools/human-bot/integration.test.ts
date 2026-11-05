import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { XiangqiRules } from '../../ui/humanBot/dist/rules/main.js';
import { engineValue } from '../../ui/humanBot/src/engine.ts';
import { BotSession, createState, decide, prepare } from '../../ui/humanBot/src/index.ts';
import {
  XiangqiAdapter,
  START_FEN,
  XiangqiKnowledge,
  xiangqiProfile,
  PROFILE_FAMILIES,
} from '../../ui/humanBot/src/xiangqi/index.ts';
import { OPENING_BRANCHES } from '../../ui/humanBot/src/xiangqi/knowledge.ts';
import { createEngine } from './engine.mjs';
import { FIXTURES, fen } from './fixtures.ts';

const rules = new XiangqiAdapter(XiangqiRules),
  pack = new XiangqiKnowledge();
const start = () => rules.restore({ initialFen: START_FEN, ruleset: 'tiantian-v1', moves: [] });
const clock = {
  capturedAt: 0,
  remainingMs: 300000,
  referenceMs: 300000,
  incrementMs: 2000,
  delayMs: 0,
  transportMs: 30,
  deadline: 300000,
};
let engine: Awaited<ReturnType<typeof createEngine>>;
before(async () => {
  engine = await createEngine(rules);
});
after(() => {
  engine?.close();
});

test('the reported double-cannon game is an actual canonical checkmate', () => {
  const moves = ['h3e3', 'a7a6', 'e3e7', 'b8g8', 'b3b6', 'g8f8', 'b6e6'];
  const position = rules.restore({ initialFen: START_FEN, ruleset: 'tiantian-v1', moves });
  assert.deepEqual(position.observation.terminal, { red: 1, black: -1 });
});
test('advanced live Pikafish avoids the reported exchange and double-cannon mate', async () => {
  for (const moves of [['h3e3'], ['h3e3', 'a7a6', 'e3e7'], ['h3e3', 'a7a6', 'e3e7', 'b8g8', 'b3b6']]) {
    const position = rules.restore({ initialFen: START_FEN, ruleset: 'tiantian-v1', moves });
    const p = xiangqiProfile('advanced', 'regression');
    const d = await decide(
      {
        id: 'turn',
        game: 'regression',
        position,
        player: 'black',
        expectedRevision: 0,
        now: 0,
        clock: { ...clock, remainingMs: 900000, referenceMs: 900000, incrementMs: 0, deadline: 900000 },
      },
      p,
      createState(p, 'regression'),
      rules,
      pack,
      engine,
    );
    assert.equal(d.action.kind, 'move');
    if (d.action.kind !== 'move') throw new Error('Expected a move');
    if (moves.length === 1) assert.notEqual(d.action.move, 'b8b1');
    const after = rules.play(position, d.action.move)[0].position;
    const matingReplies = after.observation.moves.filter(move => {
      const next = rules.play(after, move.action)[0].position.observation;
      return next.terminal?.red === 1;
    });
    assert.equal(
      matingReplies.length,
      0,
      `Allowed immediate mate after ${moves.join(' ')}: ${d.action.move}`,
    );
    assert(d.trace.engine.searches.length <= 3);
    assert(d.trace.intendedMs < 12000, 'No minute-long synthetic delay');
    assert(d.trace.engine.computeMs < 4000, 'Bounded computation including canonical PV validation');
    assert(d.trace.candidates[0].depth >= 5);
    assert(
      d.trace.candidates[0].engineValue >=
        Math.max(...d.trace.candidates.map(line => line.engineValue)) - 0.080001,
    );
  }
});
test('every family uses live scored evidence across tactical and quiet fixtures', async () => {
  for (const family of Object.keys(PROFILE_FAMILIES)) {
    for (const fixture of [
      { id: 'initial', fen: START_FEN },
      FIXTURES.find(f => f.id === 'rook-conversion')!,
    ]) {
      const position = rules.restore({ initialFen: fixture.fen, ruleset: 'tiantian-v1', moves: [] });
      const p = xiangqiProfile(family, fixture.id);
      const d = await decide(
        { id: fixture.id, game: 'families', player: 'red', position, expectedRevision: 0, now: 0, clock },
        p,
        createState(p, 'families'),
        rules,
        pack,
        engine,
      );
      assert(d.action.kind === 'move' && position.observation.moves.some(m => m.action === d.action.move));
      assert(d.trace.engine.searches.length > 0);
      assert(d.trace.candidates.every(c => Number.isFinite(c.engineValue)));
      assert(d.trace.units <= p.coefficients.eventBudget);
    }
  }
});
test('engine scores use the player perspective, and canonical forced outcomes dominate', async () => {
  const fixture = FIXTURES.find(f => f.id === 'rook-conversion')!;
  const position = rules.restore({ initialFen: fixture.fen, ruleset: 'tiantian-v1', moves: [] });
  const evidence = await engine.analyze({
    position,
    player: 'red',
    actions: position.observation.moves.map(m => m.action),
    nodes: 16000,
    multiPv: 3,
    maxTimeMs: 1000,
  });
  assert(engineValue(evidence.lines[0], 'red') > 900);
  assert(engineValue(evidence.lines[0], 'black') < -900);
  assert(evidence.lines.every(line => position.observation.moves.some(move => move.action === line.action)));
});
test('forecast preparation spends observed waiting and requires an exact response history', async () => {
  const p = xiangqiProfile('advanced'),
    session = new BotSession(p, rules, pack, engine, 'prepare');
  const position = start();
  const d = await session.propose({
    id: 'first',
    game: 'prepare',
    player: 'red',
    position,
    expectedRevision: 0,
    now: 0,
    clock,
  });
  assert(d.action.kind === 'move');
  if (d.action.kind !== 'move') throw new Error('Expected a move');
  const after = rules.play(position, d.action.move)[0].position;
  session.accept(d.token, position, after, d.submitAt);
  assert.equal(prepare(after, 'red', p, session.state(), 0, rules).length, 0);
  assert.throws(() => prepare(after, 'red', p, session.state(), -1, rules));
  const preparations = prepare(after, 'red', p, session.state(), 10000, rules);
  assert(preparations.length > 0 && preparations.length <= 4);
  for (const prepared of preparations) {
    const matching = after.observation.moves
      .map(move => rules.play(after, move.action)[0].position)
      .find(pos => pos.key === prepared.afterKey);
    assert(matching?.observation.moves.some(move => move.action === prepared.action));
  }
});
test('abort closes native work and a new engine can immediately resume play', async () => {
  const temporary = await createEngine(rules);
  const position = start(),
    controller = new AbortController();
  const pending = temporary.analyze({
    position,
    player: 'red',
    actions: position.observation.moves.map(m => m.action),
    nodes: 1000000,
    multiPv: 6,
    maxTimeMs: 5000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, /aborted/i);
  assert(temporary.closed);
  await assert.rejects(
    temporary.analyze({
      position,
      player: 'red',
      actions: ['h3e3'],
      nodes: 1000,
      multiPv: 1,
      maxTimeMs: 100,
    }),
  );
  const replacement = await createEngine(rules);
  try {
    const evidence = await replacement.analyze({
      position,
      player: 'red',
      actions: ['h3e3'],
      nodes: 1000,
      multiPv: 1,
      maxTimeMs: 500,
    });
    assert.equal(evidence.bestAction, 'h3e3');
  } finally {
    replacement.close();
  }
});
test('restoration reuses exact history prefixes and excludes diagnostic metadata from identity', () => {
  let initializations = 0,
    transitions = 0;
  const adapter = new XiangqiAdapter({
    initial: (fen, policy) => {
      initializations++;
      return XiangqiRules.initial(fen, policy);
    },
    play: (position, action) => {
      transitions++;
      return XiangqiRules.play(position, action);
    },
    inspect: position => XiangqiRules.inspect(position),
    targets: (position, square) => XiangqiRules.targets(position, square),
  });
  const snapshot = {
    initialFen: START_FEN,
    ruleset: 'tiantian-v1' as const,
    moves: ['h3e3', 'h10g8', 'h1g3', 'b10c8'],
  };
  const first = adapter.restore(snapshot);
  assert.equal(initializations, 1);
  assert.equal(transitions, 4);
  assert.equal(adapter.restore(snapshot), first);
  const extended = { ...snapshot, moves: [...snapshot.moves, 'i1h1'] };
  const second = adapter.restore(extended);
  assert.equal(initializations, 1);
  assert.equal(transitions, 5);
  adapter.play(second, second.observation.moves[0].action);
  assert.equal(
    adapter.restore(extended),
    second,
    'A hypothetical branch must not replace the accepted prefix',
  );
  const annotated = { ...extended, offlineScore: 1000000, bestMove: 'unavailable' };
  assert.equal(new XiangqiAdapter(XiangqiRules).restore(annotated).key, second.key);
  assert(Object.isFrozen(second.snapshot.moves));
  assert(Object.isFrozen(second.observation));
});

test('compiled canonical rules match the 44/1920 Pikafish initial perft reference', () => {
  const root = start();
  assert.equal(root.observation.moves.length, 44);
  assert.equal(
    root.observation.moves.reduce(
      (sum, m) => sum + rules.play(root, m.action)[0].position.observation.moves.length,
      0,
    ),
    1920,
  );
});
for (const fixture of FIXTURES)
  test(`canonical geometry: ${fixture.id}`, () => {
    const p = rules.restore({ initialFen: fixture.fen, ruleset: 'tiantian-v1', moves: [] });
    const legal = new Set(p.observation.moves.map(m => m.action));
    if (fixture.legal) assert(legal.has(fixture.legal));
    if (fixture.illegal) {
      assert(!legal.has(fixture.illegal));
      assert.throws(() => rules.play(p, fixture.illegal));
    }
  });

test('all eight horse-leg obstructions are exact, not approximated by personality', () => {
  for (const [action, leg] of [
    ['e5d7', 'e6'],
    ['e5f7', 'e6'],
    ['e5c6', 'd5'],
    ['e5c4', 'd5'],
    ['e5d3', 'e4'],
    ['e5f3', 'e4'],
    ['e5g6', 'f5'],
    ['e5g4', 'f5'],
  ]) {
    const p = rules.restore({
      initialFen: fen({ d1: 'K', f10: 'k', e5: 'N', [leg]: 'P' }),
      ruleset: 'tiantian-v1',
      moves: [],
    });
    assert(!p.observation.moves.some(m => m.action === action));
  }
});

test('stalemate and checkmate remain wins', () => {
  for (const id of ['rook-conversion', 'stalemate']) {
    const fixture = FIXTURES.find(f => f.id === id)!;
    const p = rules.restore({ initialFen: fixture.fen, ruleset: 'tiantian-v1', moves: [fixture.legal!] });
    assert.deepEqual(p.observation.terminal, { red: 1, black: -1 });
    assert.equal(p.observation.moves.length, 0);
  }
});

test('quiet repetition uses full canonical history; identical placement is not a cache identity', () => {
  const moves = ['b1c3', 'b10c8', 'c3b1', 'c8b10'];
  const twice = rules.restore({ initialFen: START_FEN, ruleset: 'tiantian-v1', moves: [...moves, ...moves] });
  const fifth = rules.restore({
    initialFen: START_FEN,
    ruleset: 'tiantian-v1',
    moves: Array.from({ length: 4 }, () => moves).flat(),
  });
  assert(!twice.observation.terminal);
  assert.deepEqual(fifth.observation.terminal, { red: 0, black: 0 });
  assert.notEqual(start().key, twice.key);
  const unrestricted = rules.restore({
    initialFen: START_FEN,
    ruleset: 'unrestricted-v1',
    moves: Array.from({ length: 4 }, () => moves).flat(),
  });
  assert(!unrestricted.observation.terminal);
  assert.notEqual(unrestricted.key, fifth.key);
});

test('perpetual chase filters the forbidden action before any candidate policy', () => {
  const p = rules.restore({
    initialFen: '4k4/9/9/9/1n7/4P4/R8/9/9/3K5 w - - 0 1',
    ruleset: 'tiantian-v1',
    moves: ['a4b4', 'b6c8', 'b4c4', 'c8b6', 'c4b4', 'b6c8', 'b4c4', 'c8b6', 'c4b4', 'b6c8', 'b4c4', 'c8b6'],
  });
  assert(!p.observation.moves.some(m => m.action === 'c4b4'));
});

test('authored opening branches are legal and recall is separated from formation transfer', () => {
  for (const [player, families] of Object.entries(OPENING_BRANCHES))
    for (const [family, branches] of Object.entries(families))
      for (const moves of branches) {
        const p = rules.restore({ initialFen: START_FEN, ruleset: 'tiantian-v1', moves });
        assert(p.observation.ply > 0);
        const before = rules.restore({
          initialFen: START_FEN,
          ruleset: 'tiantian-v1',
          moves: moves.slice(0, -1),
        });
        const recalled = pack.bindings(before.observation, player).find(b => b.recall?.family === family);
        assert(recalled?.recall?.exact, `${player}/${family}/${moves.length} must remain retrievable`);
        assert.deepEqual(recalled.actions, [moves[moves.length - 1]]);
      }
  assert(pack.bindings(start().observation, 'red').some(b => b.recall?.exact));
  const deviated = rules.restore({ initialFen: START_FEN, ruleset: 'tiantian-v1', moves: ['a4a5', 'a7a6'] });
  assert(
    pack
      .bindings(deviated.observation, 'red')
      .filter(b => b.recall)
      .every(b => !b.recall!.exact),
  );
});

test('xiangqi trap knowledge distinguishes a bait-and-recapture line from an ordinary exchange', () => {
  const cue = (bait: string, known: string[]) => {
    const before = rules.restore({
      initialFen: fen({ e10: 'k', e1: 'K', e5: 'P', a7: 'r', a4: bait, a1: 'R' }, 'b'),
      ruleset: 'tiantian-v1',
      moves: [],
    });
    const temptation = before.observation.moves.find(m => m.action === 'a7a4')!;
    const taken = rules.play(before, temptation.action)[0].position;
    const refutation = taken.observation.moves.find(m => m.action === 'a1a4')!;
    const after = rules.play(taken, refutation.action)[0].position;
    return pack.trapCue(before.observation, temptation, refutation, after.observation, known);
  };
  assert(cue('P', ['counterplay', 'recapture']) > 0);
  assert.equal(cue('P', []), 0);
  assert.equal(cue('R', ['counterplay', 'recapture']), 0);
});

test('an idle advisor move is not a defensive resource just because of its piece role', () => {
  const observation = start().observation;
  const advisor = observation.moves.find(m => m.action === 'd1e2')!;
  assert.equal(pack.moveCues(observation, advisor, ['general-safety']).defensive, 0);
  assert(pack.moveCues({ ...observation, checked: ['red'] }, advisor, ['general-safety']).defensive > 0);
});
