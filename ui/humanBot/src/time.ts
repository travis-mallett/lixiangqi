import { clamp, normal, sigmoid, uniform } from './random';
import type { BotState, ClockSnapshot, CognitiveEvent, CompiledProfile, EventKind } from './types';

export interface TimePlan {
  availableMs: number;
  targetMs: number;
  urgency: number;
  reserveMs: number;
}
export function clockPlan(
  clock: ClockSnapshot,
  now: number,
  profile: CompiledProfile,
  previousUrgency: number,
): TimePlan {
  for (const value of [
    clock.capturedAt,
    clock.remainingMs,
    clock.incrementMs,
    clock.delayMs,
    clock.referenceMs,
    clock.transportMs,
    clock.deadline,
  ])
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid clock snapshot');
  if (now < clock.capturedAt || clock.deadline < clock.capturedAt)
    throw new Error('Clock chronology is invalid');
  const elapsed = now - clock.capturedAt;
  const availableMs = Math.max(
    0,
    Math.min(clock.remainingMs + clock.delayMs - elapsed, clock.deadline - now) - clock.transportMs,
  );
  const reserveMs = Math.min(availableMs * 0.45, clock.referenceMs * profile.coefficients.reserve);
  const futureDemand = Math.max(2000, clock.referenceMs / 28 + clock.incrementMs * 0.8);
  const ratio = Math.max(1, availableMs) / futureDemand;
  const threshold = 1.5 + profile.controls.X03 * 6;
  const rawUrgency = sigmoid((threshold - ratio) * 0.8 + (previousUrgency - 0.5) * 0.6);
  const urgency = clamp(rawUrgency);
  const planningShare =
    (availableMs - reserveMs) / (18 + 16 * profile.controls.T01) +
    clock.incrementMs * 0.55 +
    Math.max(0, clock.delayMs - elapsed);
  const targetMs = Math.min(availableMs, Math.max(120, planningShare) * (0.7 + profile.controls.T02));
  return { availableMs, reserveMs, targetMs, urgency };
}
export class EventClock {
  readonly events: CognitiveEvent[] = [];
  units = 0;
  milliseconds = 0;
  private readonly speed: number;
  constructor(
    private readonly profile: CompiledProfile,
    private readonly episode: string,
    private readonly budget: number,
    private readonly timeLimit: number,
    private readonly session: BotState['session'],
  ) {
    this.speed = Math.exp(
      clamp(normal(profile.seed, `${episode}/speed`), -2, 2) * 0.08 + session.offset * 0.08,
    );
  }
  estimate(units: number, familiarity = 0, forcing = false): number {
    const c = this.profile.controls;
    return (
      this.effort(units, familiarity, forcing) *
      100 *
      this.speed *
      (1 - 0.5 * c.T03 * familiarity) *
      (1 + this.session.fatigue * c.E01 * 0.5) *
      (1 + Math.max(0, this.session.reaction) * 0.15)
    );
  }
  effort(units: number, familiarity = 0, forcing = false): number {
    return units * (forcing ? 1 - 0.45 * this.profile.controls.C06 * familiarity : 1);
  }
  can(units: number, familiarity = 0, forcing = false): boolean {
    return (
      this.units + this.effort(units, familiarity, forcing) <= this.budget &&
      this.milliseconds + this.estimate(units, familiarity, forcing) <= this.timeLimit
    );
  }
  charge(
    kind: EventKind,
    key: string,
    units: number,
    familiarity = 0,
    forcing = false,
    detail?: string,
  ): boolean {
    if (!this.can(units, familiarity, forcing)) return false;
    const milliseconds = this.estimate(units, familiarity, forcing);
    const effort = this.effort(units, familiarity, forcing);
    this.units += effort;
    this.milliseconds += milliseconds;
    this.events.push({ kind, key, units: effort, milliseconds, detail });
    return true;
  }
  /** Nonproductive events still consume the clock and cannot create new evidence. */
  interrupt(): boolean {
    const c = this.profile.controls;
    if (!c.E02 || uniform(this.profile.seed, `${this.episode}/distraction`) >= c.E02 * 0.12) return false;
    const milliseconds = Math.min(
      this.timeLimit - this.milliseconds,
      250 + uniform(this.profile.seed, `${this.episode}/distraction-length`) * 2500 * c.E02,
    );
    if (milliseconds <= 0) return false;
    this.milliseconds += milliseconds;
    this.events.push({ kind: 'interrupt', key: 'distraction', units: 0, milliseconds });
    return true;
  }
}
export function recoverSession(
  state: BotState['session'],
  profile: CompiledProfile,
  now: number,
): BotState['session'] {
  const elapsed = Math.max(0, now - state.updatedAt);
  const halfLife = 30000 + (1 - profile.controls.E04) * 270000;
  const decay = Math.exp((-Math.LN2 * elapsed) / halfLife);
  return {
    ...state,
    fatigue: state.fatigue * decay,
    reaction: state.reaction * decay,
    complacency: state.complacency * decay,
    updatedAt: now,
  };
}
