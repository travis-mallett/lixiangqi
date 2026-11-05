import { outcomeValue } from './choice';
import { attend, noticedReply } from './cognition';
import { credibleLines, engineValue, validateEvidence } from './engine';
import { dependencyValues, stale } from './memory';
import { clamp, fingerprint, freeze, normal, uniform } from './random';
import { clockPlan, EventClock, recoverSession } from './time';
import type {
  BotState,
  CandidateTrace,
  CognitiveSession,
  CompiledProfile,
  EngineAdapter,
  EngineEvidence,
  EngineLine,
  EngineQuery,
  Forecast,
  KnowledgePack,
  Observation,
  PendingDecision,
  Player,
  Preparation,
  Request,
  ResourceLimits,
  RulesAdapter,
  SearchReceipt,
} from './types';

export const DEFAULT_LIMITS: Readonly<ResourceLimits> = freeze({
  maxEvents: 128,
  maxBeliefs: 64,
  maxNodes: 131072,
  maxComputeMs: 2000,
  maxCandidates: 6,
  maxPvPlies: 32,
});
export function createState(
  profile: CompiledProfile,
  game: string,
  session: string = game,
  now = 0,
  priorSession?: CognitiveSession,
): BotState {
  if (!game || !session || !Number.isFinite(now) || now < 0)
    throw new Error('Invalid game or session identity');
  if (
    priorSession &&
    (priorSession.id !== session ||
      priorSession.profile !== profile.fingerprint ||
      priorSession.updatedAt > now)
  )
    throw new Error('Session carryover belongs to another identity or a later time');
  return {
    version: profile.modelVersion,
    profile: profile.fingerprint,
    game,
    revision: 0,
    lastPly: -1,
    beliefs: [],
    expected: { unknown: 1 },
    preparations: [],
    forecasts: [],
    urgency: 0,
    subjectiveValue: 0,
    session: priorSession
      ? recoverSession(priorSession, profile, now)
      : {
          id: session,
          profile: profile.fingerprint,
          fatigue: 0,
          reaction: 0,
          complacency: 0,
          offset: profile.controls.E08
            ? profile.controls.E08 * (uniform(profile.seed, `session/${session}`) - 0.5)
            : 0,
          updatedAt: now,
        },
  };
}
/** Retry identity excludes elapsed runtime, but includes the authoritative clock snapshot. */
export function requestFingerprint<P>(
  request: Request<P>,
  observation: Observation,
  profile: CompiledProfile,
): string {
  return fingerprint({
    id: request.id,
    game: request.game,
    player: request.player,
    observation: observation.key,
    revision: request.expectedRevision,
    clock: request.clock,
    profile: profile.fingerprint,
  });
}

/** One bounded search episode, never one engine call per thought event or candidate. */
export async function decide<P>(
  request: Request<P>,
  profile: CompiledProfile,
  state: BotState,
  rules: RulesAdapter<P>,
  pack: KnowledgePack,
  engine: EngineAdapter<P>,
  limits: ResourceLimits = DEFAULT_LIMITS,
  signal?: AbortSignal,
): Promise<PendingDecision> {
  const started = performance.now();
  if (
    profile.knowledgeVersion !== pack.manifest.version ||
    state.version !== profile.modelVersion ||
    state.profile !== profile.fingerprint ||
    state.game !== request.game ||
    state.revision !== request.expectedRevision
  )
    throw new Error('Decision version or state revision mismatch');
  if (
    Object.values(limits).some(n => !Number.isSafeInteger(n) || n < 1) ||
    limits.maxCandidates > 8 ||
    limits.maxComputeMs > 10000 ||
    limits.maxNodes > 1000000 ||
    limits.maxEvents < profile.coefficients.eventBudget
  )
    throw new Error('Unsupported resource envelope');
  const observation = rules.observe(request.position, request.player);
  if (
    observation.variant !== pack.manifest.variant ||
    observation.rulesVersion !== rules.version ||
    !observation.players.includes(request.player) ||
    observation.ply < state.lastPly
  )
    throw new Error('Rules, variant or history mismatch');
  if (observation.turn !== request.player && !observation.terminal) throw new Error('Not this bot’s turn');
  if (
    new Set(observation.moves.map(m => m.action)).size !== observation.moves.length ||
    observation.moves.some(m => m.actor !== observation.turn)
  )
    throw new Error('Invalid legal action universe');
  if (!Number.isFinite(request.now) || request.now >= request.clock.deadline)
    throw new Error('Decision deadline expired');
  if (!observation.terminal && !observation.moves.length)
    throw new Error('Rules adapter omitted a terminal outcome');
  const timing = clockPlan(request.clock, request.now, profile, state.urgency);
  if (!observation.terminal && timing.availableMs < 5) throw new Error('No spendable clock remains');
  const c = profile.controls,
    coef = profile.coefficients;
  const episode = `${request.game}/${observation.key}/${state.revision}`;
  const session = recoverSession(state.session, profile, request.now);
  const surprise = noticedReply(state, observation, pack);
  const clock = new EventClock(
    profile,
    episode,
    coef.eventBudget,
    Math.min(timing.targetMs, Math.max(0, timing.availableMs - 20)),
    session,
  );
  let plan =
    state.plan && pack.goalValid(state.plan, observation, request.player)
      ? structuredClone(state.plan)
      : undefined;
  const prepared = state.preparations.find(
    p =>
      p.afterKey === observation.key &&
      p.conditions === fingerprint(dependencyValues(observation)) &&
      observation.moves.some(m => m.action === p.action),
  );
  const attention = attend(
    request.position,
    observation,
    request.player,
    profile,
    state,
    rules,
    pack,
    clock,
    episode,
    limits.maxBeliefs,
    prepared,
  );
  const sources = new Map<string, CandidateTrace['admittedBy']>(
    attention.nominees.map(action => [action, 'knowledge']),
  );
  if (prepared) sources.set(prepared.action, 'preparation');
  const narrowing = 1 - timing.urgency * c.X04 * 0.65;
  const breadth = Math.min(limits.maxCandidates, Math.max(1, Math.round(coef.candidates * narrowing)));
  const nodeBudget = Math.min(
    limits.maxNodes,
    Math.max(
      512,
      Math.round(
        coef.nodes *
          narrowing *
          (1 - session.fatigue * c.E01 * 0.25) *
          (1 - session.complacency * c.E05 * 0.15) *
          (1 + Math.min(0, session.reaction) * 0.2),
      ),
    ),
  );
  const computeBudget = Math.min(limits.maxComputeMs, Math.max(1, timing.availableMs - 20), timing.targetMs);
  const searches: SearchReceipt[] = [];
  let usedNodes = 0;
  const search = async (
    purpose: SearchReceipt['purpose'],
    position: P,
    actions: readonly string[],
    nodes: number,
    multiPv: number,
    timeShare: number,
  ): Promise<EngineEvidence | undefined> => {
    if (signal?.aborted) throw new Error('Decision aborted');
    const left = computeBudget - (performance.now() - started);
    const allowedNodes = Math.min(Math.floor(nodes), nodeBudget - usedNodes);
    if (left < 5 || allowedNodes < 128) return;
    const query: EngineQuery<P> = {
      position,
      player: request.player,
      actions: [...actions].sort(),
      nodes: allowedNodes,
      multiPv: Math.min(multiPv, actions.length),
      maxTimeMs: Math.max(1, Math.floor(left * timeShare)),
      signal,
    };
    const evidence = await engine.analyze(query);
    validateEvidence(evidence, query, rules.observe(position, request.player), engine.version);
    usedNodes += evidence.nodes;
    searches.push({
      purpose,
      requestedNodes: query.nodes,
      nodes: evidence.nodes,
      elapsedMs: evidence.elapsedMs,
      depth: evidence.lines[0].depth,
      candidates: evidence.lines.length,
      rootActions: actions.length,
      stopped: evidence.stopped,
      unscoredBest: evidence.unscoredBest,
    });
    clock.charge(
      purpose === 'survey' ? 'generate' : purpose === 'verify' ? 'verify' : 'reply',
      `${purpose}/${evidence.bestAction}`,
      1 + Math.log2(1 + evidence.nodes / 1024) * 0.25,
      attention.familiarity,
    );
    return evidence;
  };
  let lines: readonly EngineLine[] = [];
  let replyEvidence: EngineEvidence | undefined;
  let examinedAction: string | undefined;
  let afterExamined: P | undefined;
  let certainty = 0;
  if (!observation.terminal) {
    const legal = observation.moves.map(move => move.action);
    const survey = await search(
      'survey',
      request.position,
      legal,
      Math.max(512, nodeBudget * 0.18),
      breadth,
      0.3,
    );
    if (!survey) throw new Error('Insufficient runtime budget for engine evidence');
    for (const line of survey.lines) {
      const access = clamp(coef.discovery + (attention.binding(line.action) ? 0.3 * c.K05 : 0));
      if (coef.discovery >= 0.999 || uniform(profile.seed, `${episode}/discover/${line.action}`) < access)
        sources.set(line.action, sources.get(line.action) ?? 'engine');
    }
    // Even the least knowledgeable player gets one engine-informed observation.
    // Engine failure never falls back to an unscored or random move.
    if (!survey.lines.some(line => sources.has(line.action))) sources.set(survey.bestAction, 'engine');
    lines = survey.lines.filter(line => sources.has(line.action));
    const gap =
      lines.length > 1 ? engineValue(lines[0], request.player) - engineValue(lines[1], request.player) : 0;
    certainty = clamp(0.45 + gap * 0.15 - lines[0].uncertainty * 0.35 + (c.X01 - 0.5) * 0.5);
    const verify = c.C04 >= 0.8 || certainty < 0.45 + c.T02 * 0.4 || c.K06 > 0.8 || surprise > 1;
    const replyReserve = Math.floor(nodeBudget * 0.12 * c.C03);
    if (verify) {
      const pool = coef.discovery >= 0.999 ? legal : [...sources.keys()];
      const effort = clamp(0.2 + 0.55 * c.C04 + 0.25 * c.K06 + Math.max(0, session.reaction) * 0.1, 0.2, 1);
      const verified = await search(
        'verify',
        request.position,
        pool,
        (nodeBudget - usedNodes - replyReserve) * effort,
        breadth,
        0.88,
      );
      if (verified) {
        lines = verified.lines;
        for (const line of lines) if (!sources.has(line.action)) sources.set(line.action, 'engine');
      }
    }
    // Search values already include adversarial replies. This small extra survey
    // supplies expectations and trap evidence; it never replaces minimax.
    examinedAction = [...lines].sort(
      (a, b) => engineValue(b, request.player) - engineValue(a, request.player),
    )[0].action;
    const outcomes = rules.play(request.position, examinedAction, request.player);
    if (outcomes.length === 1 && outcomes[0].probability === 1) {
      afterExamined = outcomes[0].position;
      const next = rules.observe(afterExamined, request.player);
      if (!next.terminal && next.turn !== request.player && c.C03 > 0 && next.moves.length) {
        replyEvidence = await search(
          'replies',
          afterExamined,
          next.moves.map(m => m.action),
          Math.min(replyReserve, nodeBudget - usedNodes),
          coef.replies,
          0.95,
        );
      }
    }
  }
  const qualityBand = coef.qualityBand;
  const eligible = credibleLines(lines, request.player, qualityBand);
  const bestValue = lines.length ? Math.max(...lines.map(line => engineValue(line, request.player))) : 0;
  if (state.lastObservation) {
    session.reaction = clamp(
      session.reaction + clamp((state.subjectiveValue - bestValue) / 5) * c.E03,
      -1,
      1,
    );
    session.complacency = clamp(session.complacency + clamp((bestValue - state.subjectiveValue) / 5) * c.E05);
  }
  const disconfirmed = plan && !eligible.some(line => attention.binding(line.action)?.goal === plan!.goal);
  if (disconfirmed && uniform(profile.seed, `${episode}/disconfirm`) < c.P02) {
    clock.charge('reconsider', plan!.goal, 1);
    plan = undefined;
  }
  const disconfirmedGoal = disconfirmed && !plan ? state.plan?.goal : undefined;
  const replyMass: Record<string, number> = { unknown: 1 };
  const replyOutcomes: { label: string; probability: number; value: number }[] = [];
  let trap = 0;
  if (replyEvidence && afterExamined) {
    const replyObservation = rules.observe(afterExamined, request.player);
    const maximum = Math.max(...replyEvidence.lines.map(line => engineValue(line, replyObservation.turn)));
    const weights = replyEvidence.lines.map(line =>
      Math.exp(
        clamp(
          (engineValue(line, replyObservation.turn) - maximum) * (0.25 + 1.75 * c.X05) * (0.5 + 2 * c.P04),
          -30,
          0,
        ),
      ),
    );
    const total = weights.reduce((sum, w) => sum + w, 0);
    const knownMass =
      replyEvidence.lines.length === replyObservation.moves.length
        ? 1
        : clamp(0.45 + 0.08 * replyEvidence.lines.length + 0.1 * c.X05, 0, 0.9);
    replyMass.unknown = 1 - knownMass;
    for (let i = 0; i < replyEvidence.lines.length; i++) {
      const line = replyEvidence.lines[i],
        temptation = replyObservation.moves.find(m => m.action === line.action)!;
      const category = pack.replyClass(replyObservation, temptation);
      replyMass[category] = (replyMass[category] ?? 0) + (knownMass * weights[i]) / total;
      replyOutcomes.push({
        label: line.action,
        probability: (knownMass * weights[i]) / total,
        value: engineValue(line, request.player),
      });
      const outcomes = rules.play(afterExamined, line.action, request.player);
      if (outcomes.length !== 1 || !line.pv[1]) continue;
      const next = rules.observe(outcomes[0].position, request.player);
      const refutation = next.moves.find(m => m.action === line.pv[1]);
      if (refutation && engineValue(line, request.player) > bestValue + 0.5) {
        const after = rules.play(outcomes[0].position, refutation.action, request.player);
        trap = Math.max(
          trap,
          after.reduce(
            (sum, result) =>
              sum +
              result.probability *
                pack.trapCue(
                  replyObservation,
                  temptation,
                  refutation,
                  rules.observe(result.position, request.player),
                  attention.known,
                ),
            0,
          ),
        );
      }
    }
    replyOutcomes.push({ label: 'unknown', probability: replyMass.unknown, value: bestValue - 2 * c.X05 });
  }
  const risk = clamp(coef.risk + c.E06 * Math.tanh(bestValue / 5) * 0.2, 0, 0.95);
  const candidateTraces: CandidateTrace[] = [];
  for (const line of lines) {
    const binding = attention.binding(line.action);
    let style = 0;
    for (const outcome of rules.play(request.position, line.action, request.player)) {
      const appraisal = pack.appraise(
        rules.observe(outcome.position, request.player),
        attention.beliefs.values(),
        attention.known,
        request.player,
      );
      const f = appraisal.features;
      const role = Object.entries(f.roles).reduce(
        (sum, [id, value]) => sum + ((c.S07[id] ?? 0.5) - 0.5) * value,
        0,
      );
      style +=
        outcome.probability *
        appraisal.confidence *
        Math.tanh(
          ((c.S01 - 0.5) * (f.initiative + f.activity * 0.2) +
            (c.S02 - 0.5) * f.material +
            (c.S04 - 0.5) * f.complexity +
            (c.S05 - 0.5) * f.simplification +
            (c.S06 - 0.5) * (f.prevention + f.safety * 0.2 + f.structure * 0.2) +
            role +
            (binding?.goal === plan?.goal ? c.P01 * f.progress : 0)) /
            4,
        );
    }
    if (line.forced?.[request.player] === 0) style += (c.S08 - 0.5) * 0.7;
    if (binding?.goal === plan?.goal) style += c.P01 * 0.2;
    if (line.action === examinedAction) style += trap * c.X06 * (1 - c.X05) * 0.3;
    style -= risk * line.uncertainty;
    if (line.action === examinedAction && replyOutcomes.length)
      style += clamp(
        (outcomeValue(replyOutcomes, risk) - engineValue(line, request.player)) * 0.1,
        -0.3,
        0.3,
      );
    style +=
      clamp(normal(profile.seed, `${episode}/interpretation/${line.action}`), -2, 2) *
      (1 - coef.skill) *
      line.uncertainty *
      0.2;
    const engineScore = engineValue(line, request.player);
    candidateTraces.push({
      action: line.action,
      goal: binding?.goal,
      value: engineScore + clamp(style, -1, 1) * qualityBand,
      engineValue: engineScore,
      confidence: clamp(1 - line.uncertainty + (c.X01 - 0.5) * 0.3),
      unknownMass: line.action === examinedAction ? replyMass.unknown : 1,
      replies: line.action === examinedAction ? replyMass : { unknown: 1 },
      depth: line.depth,
      admittedBy: sources.get(line.action) ?? 'engine',
    });
  }
  const usable = new Set(eligible.map(line => line.action));
  candidateTraces.sort(
    (a, b) =>
      Number(usable.has(b.action)) - Number(usable.has(a.action)) ||
      b.value - a.value ||
      a.action.localeCompare(b.action),
  );
  const favorite = candidateTraces[0];
  const chosen = lines.find(line => line.action === favorite?.action);
  const binding = favorite && attention.binding(favorite.action);
  if (binding && binding.goal !== disconfirmedGoal)
    plan = {
      goal: binding.goal,
      schema: binding.schema,
      role: binding.role,
      progress: binding.progress,
      stalled: plan?.goal === binding.goal && plan.progress >= binding.progress ? plan.stalled + 1 : 0,
      createdPly: plan?.goal === binding.goal ? plan.createdPly : observation.ply,
      reviewedPly: observation.ply,
      assumptions: binding.questions,
      expected: favorite.replies,
    };
  if (plan && plan.stalled > 3 + c.P01 * 6) plan = undefined;
  if (c.X02 > 0 && lines.length > 1) clock.charge('recheck', favorite.action, c.X02 * 4);
  if (chosen && chosen.pv.length > coef.retained)
    clock.charge(
      'reconstruct',
      chosen.action,
      Math.max(0, Math.min(chosen.pv.length, limits.maxPvPlies) - coef.retained) * 0.15,
    );
  if (!observation.terminal) clock.interrupt();
  let action: PendingDecision['action'] = observation.terminal
    ? { kind: 'terminal' }
    : { kind: 'move', move: favorite.action };
  if (
    favorite &&
    c.X07 < 0.98 &&
    favorite.engineValue < -8 - 12 * c.X07 &&
    favorite.depth >= 8 &&
    favorite.confidence > 0.6 &&
    observation.ply > 12 &&
    !observation.checked.includes(request.player)
  )
    action = { kind: 'resign' };
  const intendedAction = action.kind === 'move' ? action.move : undefined;
  if (action.kind === 'move' && c.E07 && uniform(profile.seed, `${episode}/slip`) < c.E07 * 0.015) {
    const move = observation.moves.find(m => m.action === favorite.action)!;
    const alternatives = [...pack.slipAlternatives(move, observation)]
      .filter(a => observation.moves.some(m => m.action === a))
      .sort();
    if (alternatives.length)
      action = {
        kind: 'move',
        move: alternatives[Math.floor(uniform(profile.seed, `${episode}/slip-target`) * alternatives.length)],
      };
  }
  const forecasts: Forecast[] = [];
  if (chosen && action.kind === 'move' && action.move === chosen.action) {
    // Chance outcomes are never treated as a secretly known deal.
    const rootOutcomes = rules.play(request.position, chosen.action, request.player);
    if (rootOutcomes.length === 1 && rootOutcomes[0].probability === 1) {
      const variations =
        chosen.action === examinedAction && replyEvidence
          ? replyEvidence.lines.map(line => line.pv)
          : [chosen.pv.slice(1)];
      for (const pv of variations.slice(0, Math.min(4, coef.retained))) {
        if (pv.length < 2) continue;
        const beforeReply = rootOutcomes[0].position;
        if (!rules.observe(beforeReply, request.player).moves.some(m => m.action === pv[0])) continue;
        const next = rules.play(beforeReply, pv[0], request.player);
        if (next.length !== 1 || next[0].probability !== 1) continue;
        const after = rules.observe(next[0].position, request.player);
        if (after.turn !== request.player || !after.moves.some(m => m.action === pv[1])) continue;
        forecasts.push({
          afterKey: after.key,
          action: pv[1],
          conditions: fingerprint(dependencyValues(after)),
          known: attention.known.slice(-coef.retained),
        });
      }
    }
  }
  const computeMs = performance.now() - started;
  if (!observation.terminal && computeMs >= timing.availableMs)
    throw new Error('Runtime exceeded the authoritative deadline');
  const premove = prepared?.action === intendedAction && c.X08 > uniform(profile.seed, `${episode}/premove`);
  const thinking =
    clock.milliseconds * (1 + Math.min(0, session.reaction) * 0.15) +
    (1 - certainty) * c.T02 * 900 +
    surprise * 120 +
    70 +
    uniform(profile.seed, `${episode}/execution`) * 100;
  const intendedMs = observation.terminal
    ? 0
    : Math.min(
        Math.max(0, timing.availableMs - 1),
        Math.max(computeMs, premove ? 25 : Math.min(timing.targetMs, thinking)),
      );
  const next: BotState = {
    ...state,
    revision: state.revision + 1,
    lastPly: observation.ply,
    lastObservation: observation,
    beliefs: attention.beliefs.values(),
    plan,
    focus: binding
      ? { schema: binding.schema, untilPly: observation.ply + Math.round(2 + 6 * c.A04) }
      : undefined,
    expected: favorite?.replies ?? { unknown: 1 },
    preparations: [],
    forecasts,
    urgency: timing.urgency,
    subjectiveValue: favorite?.engineValue ?? 0,
    session: {
      ...session,
      fatigue: clamp(session.fatigue + (c.E01 * clock.units) / 2000),
      updatedAt: request.now + intendedMs,
    },
  };
  const requestKey = requestFingerprint(request, observation, profile);
  return freeze({
    token: fingerprint({ requestKey, action, next }),
    request: request.id,
    requestKey,
    game: request.game,
    player: request.player,
    expectedRevision: state.revision,
    observation: observation.key,
    intendedAction,
    action,
    submitAt: request.now + intendedMs,
    expiresAt:
      Math.min(
        request.clock.deadline,
        request.clock.capturedAt + request.clock.remainingMs + request.clock.delayMs,
      ) - request.clock.transportMs,
    next,
    trace: {
      model: profile.modelVersion,
      profile: profile.fingerprint,
      knowledge: profile.knowledgeVersion,
      rules: rules.version,
      observation: observation.key,
      events: clock.events,
      retrievals: attention.retrieval.values(),
      candidates: candidateTraces,
      staleBeliefs: state.beliefs.filter(b => stale(b, observation)).map(b => b.question),
      surprise,
      units: clock.units,
      intendedMs,
      stop: observation.terminal
        ? 'terminal'
        : premove
          ? 'premove'
          : searches.some(s => s.stopped)
            ? 'clock'
            : certainty > 0.65
              ? 'confidence'
              : 'capacity',
      engine: {
        version: engine.version,
        searches,
        nodeBudget,
        discovery: coef.discovery,
        qualityBand,
        computeMs,
      },
    },
  });
}

/** Rehearse engine-derived forecasts using only time the opponent actually spent.
 * No extra search, unmetered pondering, or invented future waiting credit. */
export function prepare<P>(
  position: P,
  player: Player,
  profile: CompiledProfile,
  state: BotState,
  waitMs: number,
  rules: RulesAdapter<P>,
): readonly Preparation[] {
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('Invalid observed waiting time');
  const observation = rules.observe(position, player);
  if (observation.turn === player || observation.terminal) return [];
  const count = Math.min(state.forecasts.length, Math.floor((waitMs * profile.controls.T04) / 750));
  return state.forecasts.slice(0, count).map(forecast => ({ ...forecast, events: 1 }));
}
