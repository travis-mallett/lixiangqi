import { createState, decide, prepare, requestFingerprint, DEFAULT_LIMITS } from './decision';
import { fingerprint, freeze } from './random';
import type {
  BotState,
  CompiledProfile,
  EngineAdapter,
  KnowledgePack,
  PendingDecision,
  Player,
  Request,
  ResourceLimits,
  RulesAdapter,
} from './types';

export interface SessionSnapshot {
  state: BotState;
  pending?: PendingDecision;
  accepted: readonly string[];
}
/** One game/identity; the caller persists snapshot() atomically with its authoritative move receipt. */
export class BotSession<P> {
  private current: BotState;
  private pending?: PendingDecision;
  private readonly accepted: string[];
  private inFlight?: { key: string; promise: Promise<PendingDecision>; abort: AbortController };
  constructor(
    readonly profile: CompiledProfile,
    readonly rules: RulesAdapter<P>,
    readonly pack: KnowledgePack,
    readonly engine: EngineAdapter<P>,
    game: string,
    snapshot?: SessionSnapshot,
    readonly limits: ResourceLimits = DEFAULT_LIMITS,
  ) {
    this.current = structuredClone(snapshot?.state ?? createState(profile, game));
    this.pending = snapshot?.pending && freeze(structuredClone(snapshot.pending));
    this.accepted = [...(snapshot?.accepted ?? [])];
    if (
      this.current.game !== game ||
      this.current.profile !== profile.fingerprint ||
      this.current.version !== profile.modelVersion ||
      !Number.isSafeInteger(this.current.revision) ||
      this.current.revision < 0
    )
      throw new Error('Invalid session snapshot');
    if (
      this.pending &&
      (this.pending.expectedRevision !== this.current.revision ||
        this.pending.trace.engine.version !== engine.version ||
        this.pending.game !== game ||
        this.pending.next.profile !== profile.fingerprint ||
        this.pending.token !==
          fingerprint({
            requestKey: this.pending.requestKey,
            action: this.pending.action,
            next: this.pending.next,
          }))
    )
      throw new Error('Invalid pending decision snapshot');
  }
  state(): BotState {
    return freeze(structuredClone(this.current));
  }
  snapshot(): SessionSnapshot {
    return structuredClone({ state: this.current, pending: this.pending, accepted: this.accepted });
  }
  async propose(request: Request<P>): Promise<PendingDecision> {
    if (!Number.isFinite(request.now) || request.expectedRevision !== this.current.revision)
      throw new Error('Invalid proposal time or revision');
    const observation = this.rules.observe(request.position, request.player);
    const requestKey = requestFingerprint(request, observation, this.profile);
    if (this.pending) {
      if (this.pending.requestKey !== requestKey)
        throw new Error('Another request is pending; cancel or reconcile it first');
      if (request.now >= this.pending.expiresAt) throw new Error('Pending decision expired');
      return this.pending;
    }
    if (this.inFlight) {
      if (this.inFlight.key !== requestKey) throw new Error('Another request is searching');
      return this.inFlight.promise;
    }
    const abort = new AbortController();
    const promise = decide(
      request,
      this.profile,
      this.current,
      this.rules,
      this.pack,
      this.engine,
      this.limits,
      abort.signal,
    );
    const flight = { key: requestKey, promise, abort };
    this.inFlight = flight;
    try {
      const pending = await promise;
      if (abort.signal.aborted || this.inFlight !== flight) throw new Error('Decision was cancelled');
      this.pending = pending;
      return pending;
    } finally {
      if (this.inFlight === flight) this.inFlight = undefined;
    }
  }
  /** Interrupting live native work invalidates its engine; construct a new adapter before reuse. */
  cancelSearch(): void {
    this.inFlight?.abort.abort();
  }
  cancel(token: string): void {
    if (this.pending?.token !== token) throw new Error('Unknown pending decision');
    this.pending = undefined;
  }
  accept(token: string, before: P, after: P, acceptedAt: number): BotState {
    if (this.accepted.includes(token)) return this.state();
    const pending = this.pending;
    if (!pending || pending.token !== token || pending.expectedRevision !== this.current.revision)
      throw new Error('Stale decision acceptance');
    if (!Number.isFinite(acceptedAt) || acceptedAt < pending.submitAt || acceptedAt >= pending.expiresAt)
      throw new Error('Acceptance outside decision deadline');
    const prior = this.rules.observe(before, pending.player),
      next = this.rules.observe(after, pending.player);
    if (prior.key !== pending.observation) throw new Error('Acceptance belongs to a different turn');
    if (pending.action.kind === 'move') {
      const legalOutcomes = this.rules.play(before, pending.action.move, pending.player);
      if (!legalOutcomes.some(o => this.rules.observe(o.position, pending.player).key === next.key))
        throw new Error('Authoritative acceptance does not match the proposed action');
    } else if (pending.action.kind === 'terminal' && !next.terminal)
      throw new Error('Expected an authoritative terminal result');
    else if (
      pending.action.kind === 'resign' &&
      (!next.terminal || (next.terminal[pending.player] ?? 0) >= 0)
    )
      throw new Error('Expected an authoritative resignation result');
    this.current = {
      ...structuredClone(pending.next),
      lastObservation: next,
      lastPly: next.ply,
      plan:
        pending.intendedAction &&
        pending.action.kind === 'move' &&
        pending.intendedAction !== pending.action.move
          ? undefined
          : structuredClone(pending.next.plan),
    };
    this.accepted.push(token);
    if (this.accepted.length > 32) this.accepted.shift();
    this.pending = undefined;
    return this.state();
  }
  prepare(position: P, player: Player, observedWaitMs: number): void {
    if (this.pending || this.inFlight) throw new Error('Preparation cannot change a pending decision');
    if (this.current.preparations.length) throw new Error('Preparation for this turn is already recorded');
    const observation = this.rules.observe(position, player);
    if (observation.key !== this.current.lastObservation?.key)
      throw new Error('Preparation requires the accepted current position');
    this.current = {
      ...this.current,
      preparations: prepare(position, player, this.profile, this.current, observedWaitMs, this.rules),
    };
  }
}
