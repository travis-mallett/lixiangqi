import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lowerTailMean, outcomeValue } from '../src/choice.ts';
import { CONTROL_REGISTRY, compileProfile, SCALAR_IDS } from '../src/controls.ts';
import { createState, decide, DEFAULT_LIMITS } from '../src/decision.ts';
import { credibleLines, engineValue, validateEvidence } from '../src/engine.ts';
import { BeliefLedger, RetrievalLedger, remember, stale } from '../src/memory.ts';
import { generatePopulation } from '../src/population.ts';
import { fingerprint, normal, uniform } from '../src/random.ts';
import { BotSession } from '../src/session.ts';
import { clockPlan, EventClock, recoverSession } from '../src/time.ts';
import type {
  EngineAdapter,
  EngineEvidence,
  EngineLine,
  EngineQuery,
  Binding,
  KnowledgePack,
  Observation,
  Question,
  Request,
  RulesAdapter,
} from '../src/types.ts';
import { XIANGQI_MANIFEST, XiangqiKnowledge } from '../src/xiangqi/knowledge.ts';
import { xiangqiProfile, xiangqiProfileSpec, PROFILE_FAMILIES } from '../src/xiangqi/profiles.ts';

const profile = xiangqiProfile();
const clock = {
  capturedAt: 1000,
  remainingMs: 60000,
  incrementMs: 1000,
  delayMs: 0,
  referenceMs: 60000,
  transportMs: 30,
  deadline: 61000,
};
const baseObservation: Observation = {
  key: 'root',
  rulesVersion: 'toy-1',
  variant: 'xiangqi',
  turn: 'red',
  players: ['red', 'black', 'green'],
  ply: 0,
  pieces: [
    { id: 'a', owner: 'red', role: 'chariot', location: 'a1', x: 0, y: 1 },
    { id: 'b', owner: 'black', role: 'general', location: 'e10', x: 4, y: 10 },
  ],
  moves: ['quiet', 'capture', 'shelter'].map(action => ({
    action,
    actor: 'red',
    piece: 'a',
    role: 'chariot',
    from: 'a1',
    to: action,
    capture: action === 'capture' ? 'b' : undefined,
  })),
  checked: [],
  rulePressure: 0,
};
const question: Question = {
  id: 'ray',
  schema: 'capture',
  kind: 'attacks',
  subject: 'a',
  dependencies: ['*'],
  distance: 0,
  cost: 1,
};
const binding: Binding = {
  schema: 'capture',
  key: 'known',
  cue: 1,
  similarity: 1,
  actions: ['capture'],
  questions: ['ray'],
  goal: 'gain',
  progress: 0,
  forcing: true,
};
function fixture(reversed = false): {
  rules: RulesAdapter<string>;
  pack: KnowledgePack;
  request: Request<string>;
} {
  const observations: Record<string, Observation> = {
    root: {
      ...baseObservation,
      moves: reversed ? [...baseObservation.moves].reverse() : baseObservation.moves,
    },
  };
  for (const action of ['quiet', 'capture', 'shelter'])
    observations[action] = {
      ...baseObservation,
      key: action,
      turn: 'green',
      ply: 1,
      moves: [{ action: 'answer', actor: 'green' }],
      terminal: undefined,
    };
  observations.end = {
    ...baseObservation,
    key: 'end',
    ply: 2,
    moves: [],
    terminal: { red: 1, black: 0.5, green: 0.3 },
  };
  const rules: RulesAdapter<string> = {
    version: 'toy-1',
    restore: s => String(s),
    snapshot: s => s,
    observe: p => observations[p],
    play: (p, action) => {
      if (!observations[p].moves.some(m => m.action === action)) throw new Error('Illegal');
      return [{ probability: 1, position: p === 'root' ? action : 'end' }];
    },
    inspect: () => ({ question: 'ray', subject: 'a', kind: 'attacks', targets: ['e10'], confidence: 1 }),
  };
  const pack: KnowledgePack = {
    manifest: XIANGQI_MANIFEST,
    bindings: () => [binding],
    questions: () => [question],
    moveCues: () => ({ defensive: 0, material: 0, recapture: 0 }),
    appraise: (o, beliefs, _known, player) => ({
      confidence: beliefs.length ? 0.9 : 0.3,
      uncertainty: beliefs.length ? 0.1 : 0.7,
      terminal: o.terminal?.[player],
      features: {
        material: o.key === 'capture' ? 2 : 0,
        activity: 0,
        safety: 0,
        structure: 0,
        initiative: 0,
        complexity: 0,
        simplification: 0,
        prevention: 0,
        progress: 0,
        roles: {},
      },
    }),
    replyClass: (_o, m) => m.action,
    trapCue: () => 0,
    goalValid: () => true,
    slipAlternatives: () => [],
  };
  return {
    rules,
    pack,
    request: {
      id: 'request',
      game: 'test',
      player: 'red',
      position: 'root',
      expectedRevision: 0,
      clock,
      now: 1000,
    },
  };
}

class TestEngine implements EngineAdapter<string> {
  readonly version = 'test-engine-1';
  calls: EngineQuery<string>[] = [];
  constructor(
    private readonly rules: RulesAdapter<string>,
    readonly scores: Record<string, number> = { quiet: 1, capture: -8, shelter: 0.98, answer: 1 },
  ) {}
  async analyze(query: EngineQuery<string>): Promise<EngineEvidence> {
    this.calls.push(query);
    const lines = query.actions
      .map(action => ({
        action,
        pv: [action],
        depth: 10,
        uncertainty: 0.2,
        utilities: { red: this.scores[action], black: 0.3, green: 0.6 },
      }))
      .sort((a, b) => b.utilities.red - a.utilities.red || a.action.localeCompare(b.action))
      .slice(0, query.multiPv);
    return {
      version: this.version,
      observation: this.rules.observe(query.position, query.player).key,
      lines,
      bestAction: lines[0].action,
      nodes: query.nodes,
      elapsedMs: 2,
      stopped: false,
    };
  }
  close(): void {}
}

test('engine evidence, not handcrafted material gain, determines credible moves', async () => {
  const f = fixture(),
    p = xiangqiProfile('advanced');
  const engine = new TestEngine(f.rules);
  const decision = await decide(f.request, p, createState(p, 'test'), f.rules, f.pack, engine);
  assert.equal(decision.action.kind, 'move');
  assert.notEqual(decision.intendedAction, 'capture');
  assert(decision.trace.engine.searches.length >= 2);
  assert(engine.calls.length <= 3);
  assert(engine.calls.every(q => q.maxTimeMs <= DEFAULT_LIMITS.maxComputeMs));
  assert(engine.calls.reduce((sum, q) => sum + q.nodes, 0) <= decision.trace.engine.nodeBudget);
  assert(
    engine.calls.slice(0, 2).every(q => q.actions.length === 3),
    'Advanced verification must search every legal root',
  );
});
test('capacity increases engine work and weak profiles still choose scored legal moves', async () => {
  const f = fixture();
  const counts = [];
  for (const capacity of [0, 0.5, 1]) {
    const spec = xiangqiProfileSpec('advanced');
    spec.controls.C01 = capacity;
    const p = compileProfile(spec, XIANGQI_MANIFEST),
      engine = new TestEngine(f.rules);
    const d = await decide(f.request, p, createState(p, 'test'), f.rules, f.pack, engine);
    assert(d.trace.candidates.some(line => line.action === d.intendedAction));
    counts.push(engine.calls.reduce((sum, q) => sum + q.nodes, 0));
  }
  assert(counts[0] < counts[1] && counts[1] < counts[2]);
});
test('no personality can turn an explicitly losing line into a known win', () => {
  const line = (action: string, forced?: Record<string, number>): EngineLine => ({
    action,
    pv: [action],
    depth: 12,
    uncertainty: 0.2,
    utilities: { red: 1, black: 0, green: 1 },
    forced,
  });
  const options = [
    line('win', { red: 1, black: 0.5, green: 0.3 }),
    line('loss', { red: -1, black: 0, green: 1 }),
    line('quiet'),
  ];
  assert.deepEqual(
    credibleLines(options, 'red', 2).map(l => l.action),
    ['win'],
  );
  assert(engineValue(options[0], 'black') > engineValue(options[0], 'green'));
  assert(engineValue(options[0], 'green') > engineValue(options[2], 'green'));
});
test('malformed, stale, illegal and missing-player engine evidence fails closed', async () => {
  const f = fixture(),
    engine = new TestEngine(f.rules);
  const q: EngineQuery<string> = {
    position: 'root',
    player: 'red',
    actions: ['quiet'],
    nodes: 1000,
    multiPv: 1,
    maxTimeMs: 100,
  };
  const evidence = await engine.analyze(q);
  validateEvidence(evidence, q, baseObservation, engine.version);
  for (const mutate of [
    (e: EngineEvidence) => {
      e.observation = 'stale';
    },
    (e: EngineEvidence) => {
      e.bestAction = 'capture';
    },
    (e: EngineEvidence) => {
      e.lines = [{ ...e.lines[0], utilities: { red: 1 } }];
    },
    (e: EngineEvidence) => {
      e.lines = [{ ...e.lines[0], uncertainty: NaN }];
    },
  ]) {
    const bad = structuredClone(evidence);
    mutate(bad);
    assert.throws(() => validateEvidence(bad, q, baseObservation, engine.version));
  }
  const broken: EngineAdapter<string> = {
    version: 'broken',
    analyze: async () => {
      throw new Error('engine unavailable');
    },
    close: () => {},
  };
  await assert.rejects(
    decide(f.request, profile, createState(profile, 'test'), f.rules, f.pack, broken),
    /unavailable/,
  );
});
test('legal-container ordering cannot change a seeded policy with identical evidence', async () => {
  const a = fixture(),
    b = fixture(true);
  const p = xiangqiProfile('advanced');
  const left = await decide(a.request, p, createState(p, 'test'), a.rules, a.pack, new TestEngine(a.rules));
  const right = await decide(b.request, p, createState(p, 'test'), b.rules, b.pack, new TestEngine(b.rules));
  assert.deepEqual(left.action, right.action);
  assert.deepEqual(left.trace.candidates, right.trace.candidates);
  assert.equal(left.trace.intendedMs, right.trace.intendedMs);
});
test('simultaneous retries share one analysis and pending retries and restore use no engine work', async () => {
  const f = fixture(),
    engine = new TestEngine(f.rules);
  const s = new BotSession(profile, f.rules, f.pack, engine, 'test');
  const [first, retry] = await Promise.all([s.propose(f.request), s.propose(f.request)]);
  assert.deepEqual(first, retry);
  const calls = engine.calls.length;
  assert.deepEqual(await s.propose({ ...f.request, now: 1100 }), first);
  const restored = new BotSession(profile, f.rules, f.pack, engine, 'test', s.snapshot());
  assert.deepEqual(await restored.propose(f.request), first);
  assert.equal(engine.calls.length, calls);
  assert.throws(() => s.accept(first.token, 'root', 'end', first.submitAt));
  const state = s.accept(first.token, 'root', first.intendedAction!, first.submitAt);
  assert.equal(state.revision, 1);
  assert.deepEqual(s.accept(first.token, 'root', first.intendedAction!, first.submitAt), state);
});
test('in-flight cancellation cannot install or accept a late result', async () => {
  const f = fixture();
  let finish!: () => void;
  const entered = Promise.withResolvers<void>();
  const base = new TestEngine(f.rules);
  const engine: EngineAdapter<string> = {
    version: base.version,
    close: () => {},
    analyze: async q => {
      entered.resolve();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return base.analyze(q);
    },
  };
  const s = new BotSession(profile, f.rules, f.pack, engine, 'test');
  const proposal = s.propose(f.request);
  await entered.promise;
  s.cancelSearch();
  finish();
  await assert.rejects(proposal, /aborted|cancelled/i);
  assert.equal(s.snapshot().pending, undefined);
  assert.equal(s.state().revision, 0);
});
test('terminal outcomes do not call the engine or manufacture thinking time', async () => {
  const f = fixture(),
    engine = new TestEngine(f.rules);
  const d = await decide(
    { ...f.request, position: 'end' },
    profile,
    createState(profile, 'test'),
    f.rules,
    f.pack,
    engine,
  );
  assert.equal(d.action.kind, 'terminal');
  assert.equal(d.trace.intendedMs, 0);
  assert.equal(d.trace.units, 0);
  assert.equal(engine.calls.length, 0);
});
test('chance transitions remain public probability distributions, not a selected hidden deal', async () => {
  const f = fixture();
  const play = f.rules.play;
  f.rules.play = (p, a, player) =>
    p === 'root'
      ? [
          { probability: 0.4, position: 'quiet' },
          { probability: 0.6, position: 'shelter' },
        ]
      : play(p, a, player);
  const engine = new TestEngine(f.rules);
  const d = await decide(f.request, profile, createState(profile, 'test'), f.rules, f.pack, engine);
  assert(engine.calls.every(q => q.position === 'root'));
  assert.equal(d.next.forecasts.length, 0);
  assert(d.trace.candidates.every(line => Number.isFinite(line.value)));
});
test('expired clocks, stale revisions, tampered pending snapshots and competing requests reject', async () => {
  const f = fixture(),
    engine = new TestEngine(f.rules);
  const s = new BotSession(profile, f.rules, f.pack, engine, 'test');
  await assert.rejects(s.propose({ ...f.request, expectedRevision: 1 }));
  await assert.rejects(s.propose({ ...f.request, now: 999999 }));
  const d = await s.propose(f.request);
  await assert.rejects(s.propose({ ...f.request, id: 'other' }));
  const saved = s.snapshot();
  saved.pending!.next.revision += 1;
  assert.throws(() => new BotSession(profile, f.rules, f.pack, engine, 'test', saved));
  s.cancel(d.token);
  assert.throws(() => s.accept(d.token, 'root', 'quiet', d.submitAt));
});

test('registry exposes all 48 controls, 32 core, eight advanced, eight experimental', () => {
  assert.equal(CONTROL_REGISTRY.length, 48);
  assert.equal(new Set(CONTROL_REGISTRY.map(c => c.id)).size, 48);
  for (const [tier, count] of [
    ['core', 32],
    ['advanced', 8],
    ['experimental', 8],
  ] as const)
    assert.equal(CONTROL_REGISTRY.filter(c => c.tier === tier).length, count);
  assert.equal(SCALAR_IDS.length, 45);
  assert(Object.isFrozen(profile.controls.K03));
});

test('every scalar accepts supported extrema and rejects invalid numbers', () => {
  for (const contract of CONTROL_REGISTRY.filter(c => c.kind === 'scalar')) {
    for (const value of [contract.min, contract.nominal, contract.max]) {
      const spec = xiangqiProfileSpec();
      spec.experimental = true;
      spec.controls[contract.id as (typeof SCALAR_IDS)[number]] = value;
      assert.equal(compileProfile(spec, XIANGQI_MANIFEST).controls[contract.id], value);
    }
    for (const value of [NaN, Infinity, contract.max + 0.01, contract.min - 0.01]) {
      const spec = xiangqiProfileSpec();
      spec.experimental = true;
      spec.controls[contract.id as (typeof SCALAR_IDS)[number]] = value;
      assert.throws(() => compileProfile(spec, XIANGQI_MANIFEST));
    }
  }
});

test('compiler rejects experimental leakage, missing knowledge, invalid mixtures and role maps', () => {
  const cases = [
    (s: ReturnType<typeof xiangqiProfileSpec>) => {
      s.controls.E02 = 0.2;
    },
    (s: ReturnType<typeof xiangqiProfileSpec>) => {
      s.controls.K03.capture = 'absent';
    },
    (s: ReturnType<typeof xiangqiProfileSpec>) => {
      s.controls.K01.red = { unknown: 1 };
    },
    (s: ReturnType<typeof xiangqiProfileSpec>) => {
      s.controls.K01.red = { 'central-cannon': 0.2 };
    },
    (s: ReturnType<typeof xiangqiProfileSpec>) => {
      s.controls.S07.extra = 0.5;
    },
    (s: ReturnType<typeof xiangqiProfileSpec>) => {
      s.modelVersion = 'wrong';
    },
  ];
  for (const mutate of cases) {
    const spec = xiangqiProfileSpec();
    mutate(spec);
    assert.throws(() => compileProfile(spec, XIANGQI_MANIFEST));
  }
  for (const family of Object.keys(PROFILE_FAMILIES)) assert(xiangqiProfile(family).fingerprint);
});

test('population draws are reproducible, correlated, diverse and do not pile at bounds', () => {
  const spec = {
    seed: 'population',
    count: 1000,
    base: xiangqiProfileSpec(),
    axes: [
      { control: 'C01' as const, mean: 0.5, deviation: 0.12 },
      { control: 'C05' as const, mean: 0.5, deviation: 0.12 },
    ],
    correlations: [
      [1, 0.8],
      [0.8, 1],
    ],
  };
  const population = generatePopulation(spec, XIANGQI_MANIFEST);
  assert.deepEqual(population, generatePopulation(spec, XIANGQI_MANIFEST));
  assert.equal(new Set(population.map(p => p.fingerprint)).size, 1000);
  const x = population.map(p => p.controls.C01 - 0.5),
    y = population.map(p => p.controls.C05 - 0.5);
  const corr =
    x.reduce((s, n, i) => s + n * y[i], 0) /
    Math.sqrt(x.reduce((s, n) => s + n * n, 0) * y.reduce((s, n) => s + n * n, 0));
  assert(corr > 0.7 && corr < 0.9);
  assert(population.every(p => p.controls.C01 > 0 && p.controls.C01 < 1));
  assert.throws(() =>
    generatePopulation(
      {
        ...spec,
        correlations: [
          [1, 2],
          [2, 1],
        ],
      },
      XIANGQI_MANIFEST,
    ),
  );
});

test('keyed randomness has no stream shared with logs or other profiles', () => {
  const value = normal('identity', 'episode');
  for (let i = 0; i < 100; i++) uniform('other', String(i));
  assert.equal(normal('identity', 'episode'), value);
  assert.notEqual(normal('identity', 'episode2'), value);
});

test('retrieval is one shared event; another read cannot reroll or change latency', () => {
  const ledger = new RetrievalLedger(profile, 'episode');
  const first = ledger.retrieve(binding, 'evidence', 0);
  assert.equal(ledger.retrieve(binding, 'evidence', 0), first);
  assert.equal(ledger.values().length, 1);
  ledger.retrieve(binding, 'new-evidence', 0);
  assert.equal(ledger.values().length, 2);
});

test('retrieval accessibility couples success and latency; transfer only changes near-matches', () => {
  const counts = [0, 1].map(access => {
    let successes = 0,
      cost = 0;
    for (let seed = 0; seed < 200; seed++) {
      const spec = xiangqiProfileSpec('neutral', String(seed));
      spec.controls.K05 = access;
      const p = compileProfile(spec, XIANGQI_MANIFEST);
      const record = new RetrievalLedger(p, 'access').retrieve(binding, 'same', 0);
      successes += Number(record.available);
      cost += record.cost;
    }
    return { successes, cost };
  });
  assert(counts[1].successes > counts[0].successes);
  assert(counts[1].cost < counts[0].cost);
  const activation = (transfer: number, similarity: number) => {
    const spec = xiangqiProfileSpec();
    spec.controls.K04 = transfer;
    return new RetrievalLedger(compileProfile(spec, XIANGQI_MANIFEST), 'same').retrieve(
      { ...binding, similarity },
      'same',
      0,
    ).activation;
  };
  assert.equal(activation(0, 1), activation(1, 1));
  assert(activation(1, 0.6) > activation(0, 0.6));
});

test('all three structured controls can vary coherently in a generated population', () => {
  const base = xiangqiProfileSpec(),
    alternate = structuredClone(base.controls.K03);
  alternate.fortress = 'absent';
  const population = generatePopulation(
    {
      seed: 'structured',
      count: 40,
      base,
      axes: [],
      repertoireDeviation: 0.2,
      roleDeviation: 0.1,
      curricula: [
        { weight: 0.5, knowledge: base.controls.K03 },
        { weight: 0.5, knowledge: alternate },
      ],
    },
    XIANGQI_MANIFEST,
  );
  assert(new Set(population.map(p => p.controls.K01.red['central-cannon'])).size > 1);
  assert(new Set(population.map(p => p.controls.S07['active-rook'])).size > 1);
  assert.equal(new Set(population.map(p => p.controls.K03.fortress)).size, 2);
});

test('experimental recovery and fatigue are distinct, bounded controls', () => {
  const slow = xiangqiProfileSpec();
  slow.experimental = true;
  slow.controls.E01 = 1;
  const fast = structuredClone(slow);
  fast.controls.E04 = 1;
  const a = compileProfile(slow, XIANGQI_MANIFEST),
    b = compileProfile(fast, XIANGQI_MANIFEST);
  const state = { ...createState(a, 'session').session, fatigue: 1, reaction: 0.5 };
  assert(recoverSession(state, b, 60000).fatigue < recoverSession(state, a, 60000).fatigue);
  const tired = new EventClock(a, 'same', 100, 100000, state);
  const fresh = new EventClock(a, 'same', 100, 100000, { ...state, fatigue: 0 });
  assert(tired.estimate(4) > fresh.estimate(4));
});

test('stale diagnostics do not secretly rewrite subjective assumptions', () => {
  const belief = remember(
    { question: 'ray', subject: 'a', kind: 'attacks', targets: ['e10'], confidence: 1 },
    question,
    baseObservation,
  );
  const changed = {
    ...baseObservation,
    pieces: baseObservation.pieces.map(p => (p.id === 'a' ? { ...p, location: 'a2' } : p)),
  };
  assert(stale(belief, changed));
  const ledger = new BeliefLedger([belief], 1);
  assert.deepEqual(ledger.get('ray')!.targets, ['e10']);
  ledger.put({ ...belief, question: 'new' });
  assert.equal(ledger.get('ray'), undefined);
});

test('bounded lower-tail risk is continuous for a vanishing bad event', () => {
  const entries = [
    { label: 'normal', value: 10, probability: 0.999999 },
    { label: 'rare', value: -100, probability: 0.000001 },
  ];
  assert(Math.abs(lowerTailMean(entries) - 10) < 0.001);
  assert(outcomeValue(entries, 0.75) > 9.999);
  assert.throws(() => lowerTailMean(entries, 0));
});

test('clock accounting never spends future increment; queue delay and transport consume time', () => {
  assert.throws(() => clockPlan({ ...clock, remainingMs: undefined } as never, 1000, profile, 0));
  const p = clockPlan({ ...clock, remainingMs: 1000, incrementMs: 100000, deadline: 2000 }, 1500, profile, 0);
  assert.equal(p.availableMs, 470);
  assert(p.targetMs <= 470);
  assert.equal(
    clockPlan({ ...clock, remainingMs: 1000, delayMs: 200, deadline: 2200 }, 1500, profile, 0).availableMs,
    670,
  );
  assert.throws(() => clockPlan(clock, 999, profile, 0));
});

test('urgency changes smoothly over a clock sweep and carries hysteresis', () => {
  const levels = [500, 1000, 2000, 5000, 15000, 60000].map(
    remainingMs => clockPlan({ ...clock, remainingMs }, 1000, profile, 0).urgency,
  );
  for (let i = 1; i < levels.length; i++) assert(levels[i] < levels[i - 1]);
  assert(clockPlan(clock, 1000, profile, 1).urgency > clockPlan(clock, 1000, profile, 0).urgency);
});

test('familiar proceduralized chunks are cheaper; fatigue costs time and recovery is bounded', () => {
  const state = createState(profile, 'g');
  const events = new EventClock(profile, 'e', 100, 10000, state.session);
  assert(events.estimate(4, 1, true) < events.estimate(4, 0, false));
  assert(events.charge('inspect', 'ray', 1));
  assert(events.milliseconds > 0);
  const recovered = recoverSession({ ...state.session, fatigue: 1, reaction: -0.7 }, profile, 300000);
  assert(recovered.fatigue < 1 && recovered.fatigue >= 0);
  assert(recovered.reaction < 0 && recovered.reaction > -0.7);
});

test('cross-game sessions carry only temporary psychology and recover without changing identity', () => {
  const spec = xiangqiProfileSpec();
  spec.experimental = true;
  spec.controls.E01 = 0.7;
  spec.controls.E04 = 0.6;
  spec.controls.E08 = 0.8;
  const p = compileProfile(spec, XIANGQI_MANIFEST);
  const prior = createState(p, 'first-game', 'evening', 1000);
  prior.session.fatigue = 0.8;
  prior.session.reaction = 0.4;
  const next = createState(p, 'second-game', 'evening', 61000, prior.session);
  assert(next.session.fatigue > 0 && next.session.fatigue < 0.8);
  assert.equal(next.session.offset, prior.session.offset);
  assert.equal(next.revision, 0);
  assert.equal(next.beliefs.length, 0);
  assert.equal(next.plan, undefined);
  assert.throws(() => createState(profile, 'another', 'evening', 61000, prior.session));
  assert.throws(() => createState(p, 'another', 'tomorrow', 61000, prior.session));
});

test('the knowledge pack never receives a rules engine or oracle capability', () => {
  const pack = new XiangqiKnowledge();
  assert.equal(fingerprint(pack.manifest), fingerprint(XIANGQI_MANIFEST));
  assert(!('engine' in pack));
  assert(!('rules' in pack));
});
