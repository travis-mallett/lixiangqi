import { BeliefLedger, RetrievalLedger, remember, stale } from './memory';
import { clamp, uniform } from './random';
import type { EventClock } from './time';
import type {
  Binding,
  BotState,
  CompiledProfile,
  KnowledgePack,
  Move,
  Observation,
  Player,
  Preparation,
  RulesAdapter,
} from './types';

export interface Attention {
  bindings: readonly Binding[];
  known: readonly string[];
  retrieval: RetrievalLedger;
  beliefs: BeliefLedger;
  nominees: readonly string[];
  familiarity: number;
  binding(action: string): Binding | undefined;
}
function repertoire(profile: CompiledProfile, player: Player, game: string): string | undefined {
  let draw = uniform(profile.seed, `${game}/repertoire/${player}`);
  for (const [id, weight] of Object.entries(profile.controls.K01[player] ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    draw -= weight;
    if (draw <= 0) return id;
  }
  return Object.keys(profile.controls.K01[player] ?? {})
    .sort()
    .slice(-1)[0];
}
/** Bounded descriptive knowledge work. This never searches for or evaluates a best move. */
export function attend<P>(
  position: P,
  observation: Observation,
  player: Player,
  profile: CompiledProfile,
  state: BotState,
  rules: RulesAdapter<P>,
  pack: KnowledgePack,
  clock: EventClock,
  episode: string,
  maxBeliefs: number,
  prepared?: Preparation,
): Attention {
  const c = profile.controls;
  const focus = state.focus && state.focus.untilPly >= observation.ply ? state.focus.schema : undefined;
  const retrieval = new RetrievalLedger(profile, episode);
  const beliefs = new BeliefLedger(state.beliefs, maxBeliefs);
  const known = new Set<string>(prepared?.known);
  const bindings: Binding[] = [];
  if (observation.terminal)
    return {
      bindings,
      known: [],
      retrieval,
      beliefs,
      nominees: [],
      familiarity: 0,
      binding: () => undefined,
    };
  const family = repertoire(profile, player, state.game);
  const candidates = pack
    .bindings(observation, player)
    .filter(b => !b.recall || (b.recall.family === family && b.recall.extent <= c.K02))
    .sort(
      (a, b) =>
        b.cue + (b.schema === focus ? c.A04 : 0) - (a.cue + (a.schema === focus ? c.A04 : 0)) ||
        a.key.localeCompare(b.key),
    );
  const include = (schema: string): void => {
    if (known.has(schema)) return;
    known.add(schema);
    for (const dependency of pack.manifest.schemas.find(s => s.id === schema)?.prerequisites ?? [])
      include(dependency);
  };
  clock.charge('orient', observation.key, prepared ? 0.5 : 1);
  for (const b of candidates.slice(0, 32)) {
    // Retrieval is keyed once per episode: repeated attention never rerolls success.
    if (!clock.can(5)) break;
    const r = retrieval.retrieve(b, observation.key, 0, state.plan?.goal, state.session.offset);
    clock.charge(
      'retrieve',
      b.key,
      r.cost,
      b.recall?.exact || r.mastery === 'proceduralized' || prepared?.known.includes(b.schema) ? 1 : 0,
      b.forcing && r.mastery === 'proceduralized',
    );
    if (r.available) {
      bindings.push(b);
      include(b.schema);
    }
  }
  const questions = pack
    .questions(observation, player)
    .filter(
      q =>
        known.has(q.schema) &&
        ['understood', 'proceduralized'].includes(c.K03[q.schema]) &&
        q.distance <= 0.2 + 0.8 * c.A03,
    );
  questions.sort((a, b) => {
    const priority = (q: typeof a): number => {
      const enemy = observation.pieces.find(p => p.id === q.subject)?.owner !== player;
      return (
        (enemy ? c.A01 : 1 - c.A01) * 2 + (q.schema === focus ? c.A04 : 0) - q.distance * (1 - c.A03) * 0.1
      );
    };
    return priority(b) - priority(a) || a.id.localeCompare(b.id);
  });
  for (const q of questions.slice(0, Math.round((2 + 10 * c.K06) * (0.35 + 0.65 * c.A03)))) {
    const existing = beliefs.get(q.id);
    if (existing && !stale(existing, observation)) continue;
    if (!clock.charge('inspect', q.id, q.cost, c.K03[q.schema] === 'proceduralized' ? 1 : 0)) break;
    beliefs.put(remember(rules.inspect(position, q, player), q, observation));
  }
  const binding = (action: string): Binding | undefined =>
    bindings
      .filter(b => b.actions.includes(action))
      .sort((a, b) => b.cue - a.cue || a.key.localeCompare(b.key))[0];
  const salience = (move: Move): number => {
    const b = binding(move.action),
      cues = pack.moveCues(observation, move, [...known]);
    return (
      (b?.cue ?? 0) +
      (b?.recall ? c.K02 : 0) +
      cues.defensive * c.A01 +
      (!move.capture ? c.A02 * (0.3 + cues.defensive) : 0) +
      cues.material * c.S02 +
      cues.recapture +
      (b?.goal === state.plan?.goal ? c.P01 * 0.5 : 0) +
      (b?.schema === focus ? c.A04 * 0.4 : 0) +
      uniform(profile.seed, `${episode}/salience/${move.action}`) * 0.15
    );
  };
  const moves = [...observation.moves].sort(
    (a, b) => salience(b) - salience(a) || a.action.localeCompare(b.action),
  );
  const nominees: string[] = [];
  const families = new Set<string>();
  while (moves.length && nominees.length < profile.coefficients.candidates) {
    moves.sort((a, b) => {
      const score = (move: Move): number =>
        salience(move) + (families.has(binding(move.action)?.schema ?? move.role ?? '') ? 0 : c.P03 * 0.7);
      return score(b) - score(a) || a.action.localeCompare(b.action);
    });
    const move = moves.shift()!;
    nominees.push(move.action);
    families.add(binding(move.action)?.schema ?? move.role ?? '');
    clock.charge('generate', move.action, 0.3);
  }
  return {
    bindings,
    known: [...known],
    retrieval,
    beliefs,
    nominees,
    binding,
    familiarity: clamp(
      bindings.filter(b => b.recall?.exact || c.K03[b.schema] === 'proceduralized').length / 6,
    ),
  };
}

export function noticedReply(state: BotState, current: Observation, pack: KnowledgePack): number {
  const prior = state.lastObservation;
  if (!prior || !current.lastMove) return 0;
  const category = pack.replyClass(prior, current.lastMove);
  return Math.min(5, -Math.log(Math.max(0.01, state.expected[category] ?? state.expected.unknown ?? 1)));
}
