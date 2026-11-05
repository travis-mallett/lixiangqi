import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { XiangqiRules } from '../../ui/humanBot/dist/rules/main.js';
import {
  BotSession,
  compileProfile,
  CONTROL_REGISTRY,
  MODEL_VERSION,
  createState,
  decide,
  SCALAR_IDS,
} from '../../ui/humanBot/src/index.ts';
import { fingerprint } from '../../ui/humanBot/src/random.ts';
import {
  XiangqiAdapter,
  XiangqiKnowledge,
  START_FEN,
  xiangqiProfile,
  xiangqiProfileSpec,
} from '../../ui/humanBot/src/xiangqi/index.ts';
import { createEngine } from './engine.mjs';
import { FIXTURES } from './fixtures.ts';
import { PikafishOracle } from './oracle.ts';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const out = resolve(arg('--out', fileURLToPath(new URL('../../.tools/human-bot-lab.json', import.meta.url))));
const rules = new XiangqiAdapter(XiangqiRules),
  pack = new XiangqiKnowledge();
const engine = await createEngine(rules);
const oracle = process.argv.includes('--oracle') ? new PikafishOracle() : undefined;
const report: Record<string, unknown> = {
  model: MODEL_VERSION,
  knowledge: pack.manifest.version,
  evidence: 'synthetic only; no human calibration',
  controls: CONTROL_REGISTRY,
  fixtures: [],
  games: [],
  interventions: [],
};
const times: number[] = [];
async function measured(
  fen: string,
  id: string,
  spec = xiangqiProfileSpec(),
  context: { moves?: readonly string[]; initialMs?: number; incrementMs?: number } = {},
) {
  const initialMs = context.initialMs ?? 300000;
  await engine.reset();
  const profile = compileProfile(spec, pack.manifest),
    position = rules.restore({ initialFen: fen, ruleset: 'tiantian-v1', moves: context.moves ?? [] });
  report.currentSample = { id, snapshot: position.snapshot, profile: spec };
  const start = performance.now();
  const pending = await decide(
    {
      id,
      game: id,
      player: position.observation.turn,
      position,
      expectedRevision: 0,
      now: 0,
      clock: {
        capturedAt: 0,
        remainingMs: initialMs,
        referenceMs: initialMs,
        incrementMs: context.incrementMs ?? 2000,
        delayMs: 0,
        transportMs: 30,
        deadline: initialMs,
      },
    },
    profile,
    createState(profile, id),
    rules,
    pack,
    engine,
  );
  const cpuMs = performance.now() - start;
  times.push(cpuMs);
  return { pending, cpuMs, position };
}
try {
  for (const fixture of [{ id: 'initial', fen: START_FEN }, ...FIXTURES]) {
    const { pending, cpuMs, position } = await measured(fixture.fen, fixture.id);
    const annotation = oracle
      ? await oracle.analyze(
          position.snapshot,
          position.observation.moves.map(m => m.action),
          100000,
        )
      : undefined;
    if (annotation && !position.observation.moves.some(m => m.action === annotation.bestMove))
      throw new Error('Illegal oracle response');
    (report.fixtures as unknown[]).push({
      id: fixture.id,
      cpuMs,
      policyMs: cpuMs - pending.trace.engine.searches.reduce((sum, search) => sum + search.elapsedMs, 0),
      search: pending.trace.engine,
      action: pending.action,
      intendedMs: pending.trace.intendedMs,
      units: pending.trace.units,
      candidates: pending.trace.candidates,
      offline: annotation,
    });
  }
  console.log('Completed live-engine fixtures');
  if (process.argv.includes('--sweep')) {
    const openings = [
      ['h3e3', 'a7a6', 'e3e7'],
      ['h3e3', 'a7a6', 'e3e7', 'b8g8', 'b3b6'],
      [],
      ['h3e3'],
      ['b3e3'],
      ['h1g3'],
      ['c1e3'],
      ['h3e3', 'b8b1', 'a1b1'],
    ];
    const advancedOpenings: unknown[] = [];
    for (const moves of openings) {
      const analyses = new Map();
      let best;
      for (let index = 0; index < 8; index++) {
        const spec = xiangqiProfileSpec('advanced', index ? `qualification/${index}` : 'advanced-reference');
        const { pending, cpuMs, position } = await measured(
          START_FEN,
          `opening-qualification/${index}`,
          spec,
          {
            moves,
            initialMs: 900000,
            incrementMs: 0,
          },
        );
        if (pending.action.kind !== 'move') throw new Error('Unexpected advanced opening termination');
        if (oracle) {
          best ??= await oracle.analyze(
            position.snapshot,
            position.observation.moves.map(m => m.action),
            100000,
          );
          if (!analyses.has(pending.action.move))
            analyses.set(
              pending.action.move,
              await oracle.analyze(position.snapshot, [pending.action.move], 100000),
            );
        }
        advancedOpenings.push({
          moves,
          seed: spec.seed,
          action: pending.action,
          cpuMs,
          search: pending.trace.engine,
          intendedMs: pending.trace.intendedMs,
          units: pending.trace.units,
          stop: pending.trace.stop,
          candidates: pending.trace.candidates,
          offline: oracle ? { best, selected: analyses.get(pending.action.move) } : undefined,
        });
      }
      console.log(`Completed advanced probe: ${moves.join(' ') || 'start'}`);
    }
    report.advancedOpeningProbe = advancedOpenings;
    report.openingProbe = [];
    for (const capacity of [0.25, 0.5, 0.75]) {
      const actions: Record<string, number> = {};
      let captures = 0;
      for (let index = 0; index < 24; index++) {
        const spec = xiangqiProfileSpec('neutral', `opening/holdout/${index}`);
        spec.controls.C01 = capacity;
        const { pending, position } = await measured(START_FEN, 'opening-opportunity', spec);
        if (pending.action.kind !== 'move') throw new Error('Unexpected opening termination');
        actions[pending.action.move] = (actions[pending.action.move] ?? 0) + 1;
        captures += Number(!!position.observation.moves.find(m => m.action === pending.action.move)?.capture);
      }
      (report.openingProbe as unknown[]).push({ capacity, samples: 24, captures, actions });
    }
    for (const id of SCALAR_IDS) {
      const entries: unknown[] = [];
      for (const value of id === 'E03' ? [-1, 0, 1] : [0, 0.5, 1]) {
        const spec = xiangqiProfileSpec();
        spec.experimental = true;
        spec.controls[id] = value;
        const results: unknown[] = [];
        for (const [index, fen] of [START_FEN, FIXTURES[0].fen, FIXTURES[8].fen].entries()) {
          const { pending } = await measured(fen, `sensitivity/${index}`, spec);
          results.push({
            action: pending.action,
            searches: pending.trace.engine.searches.map(({ elapsedMs: _elapsedMs, ...rest }) => rest),
            units: pending.trace.units,
            time: pending.trace.intendedMs,
            candidates: pending.trace.candidates.length,
            maxDepth: Math.max(0, ...pending.trace.candidates.map(c => c.depth)),
            inspections: pending.trace.events.filter(e => e.kind === 'inspect' || e.kind === 'verify').length,
            retrievals: pending.trace.retrievals.filter(r => r.available).length,
            rechecks: pending.trace.events.filter(e => e.kind === 'recheck').length,
            subjective: pending.trace.candidates.map(c => ({
              action: c.action,
              value: c.value,
              unknown: c.unknownMass,
              replies: c.replies,
            })),
          });
        }
        entries.push({ value, results });
      }
      (report.interventions as unknown[]).push({
        control: id,
        entries,
        observableChange: new Set(entries.map((e: any) => fingerprint(e.results))).size > 1,
      });
    }
    console.log('Completed scalar interventions (independent engine resets)');
  }
  const games = Number(arg('--games', '2'));
  if (!Number.isInteger(games) || games < 0 || games > 20)
    throw new Error('This diagnostic runner supports 0 to 20 games, not population training');
  for (let index = 0; index < games; index++) {
    await engine.reset();
    let position = rules.restore({ initialFen: START_FEN, ruleset: 'tiantian-v1', moves: [] }),
      now = 0;
    const sessions = Object.fromEntries(
      ['red', 'black'].map(player => [
        player,
        new BotSession(
          xiangqiProfile(index % 2 === 0 ? 'attacker' : 'advanced', `lab/${index}/${player}`),
          rules,
          pack,
          engine,
          `game/${index}`,
        ),
      ]),
    );
    const history: unknown[] = [];
    const remaining: Record<string, number> = { red: 900000, black: 900000 };
    let ending: unknown;
    while (!position.observation.terminal && history.length < 160) {
      report.currentGame = { index, snapshot: position.snapshot, ply: history.length };
      const player = position.observation.turn,
        session = sessions[player];
      if (remaining[player] <= 30) {
        ending = { kind: 'time', loser: player };
        break;
      }
      // Alternate diagnostic games against Pikafish. Its move is only an actual opponent observation.
      if (oracle && index % 2 === 1 && player === 'black') {
        const analysis = await oracle.analyze(
          position.snapshot,
          position.observation.moves.map(m => m.action),
          100000,
        );
        const elapsed = Math.max(1, analysis.timeMs);
        history.push({ player, oracleMove: analysis.bestMove, elapsedMs: elapsed });
        if (elapsed >= remaining[player]) {
          ending = { kind: 'time', loser: player };
          break;
        }
        sessions.red.prepare(position, 'red', elapsed);
        remaining[player] -= elapsed;
        position = rules.play(position, analysis.bestMove)[0].position;
        now += elapsed;
        continue;
      }
      const started = performance.now();
      const pending = await session.propose({
        id: String(history.length),
        game: `game/${index}`,
        player,
        position,
        now,
        expectedRevision: session.state().revision,
        clock: {
          capturedAt: now,
          remainingMs: remaining[player],
          referenceMs: 900000,
          incrementMs: 0,
          delayMs: 0,
          transportMs: 30,
          deadline: now + remaining[player],
        },
      });
      const cpuMs = performance.now() - started;
      times.push(cpuMs);
      history.push({
        player,
        action: pending.action,
        cpuMs,
        intendedMs: pending.trace.intendedMs,
        units: pending.trace.units,
      });
      if (pending.action.kind !== 'move') {
        ending = { kind: pending.action.kind, player };
        break;
      }
      const opponent = player === 'red' ? 'black' : 'red';
      if (sessions[opponent].state().lastObservation?.key === position.observation.key)
        sessions[opponent].prepare(position, opponent, pending.trace.intendedMs);
      remaining[player] -= pending.trace.intendedMs;
      const next = rules.play(position, pending.action.move)[0].position;
      session.accept(pending.token, position, next, pending.submitAt);
      position = next;
      now = pending.submitAt + 1;
    }
    (report.games as unknown[]).push({
      index,
      plies: history.length,
      result: position.observation.terminal ?? ending ?? { kind: 'diagnostic-ply-limit' },
      clock: { initialMs: 900000, incrementMs: 0, remaining },
      snapshot: position.snapshot,
      history,
    });
    console.log(`Completed diagnostic game ${index + 1}: ${history.length} plies`);
  }
  times.sort((a, b) => a - b);
  report.cpuMs = {
    samples: times.length,
    p50: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
    maximum: times[times.length - 1],
  };
  mkdirSync(dirname(out), { recursive: true });
  delete report.currentGame;
  delete report.currentSample;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        report: out,
        cpuMs: report.cpuMs,
        games: (report.games as unknown[]).length,
        interventions: (report.interventions as unknown[]).length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  report.failure = String(error);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  throw error;
} finally {
  engine.close();
  await oracle?.close();
}
