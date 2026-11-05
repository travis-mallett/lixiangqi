import { clamp, fingerprint, normal, sigmoid, uniform } from './random';
import type { Belief, Binding, CompiledProfile, Observation, Question, Relation, Retrieval } from './types';

export function dependencyValues(observation: Observation): Readonly<Record<string, string>> {
  const pieces = [...observation.pieces].sort((a, b) => a.id.localeCompare(b.id));
  return {
    '*': fingerprint(pieces),
    $history: observation.key,
    ...Object.fromEntries(pieces.map(p => [p.id, `${p.owner}/${p.role}/${p.location}`])),
  };
}
export function stale(belief: Belief, observation: Observation): boolean {
  const current = dependencyValues(observation);
  return Object.entries(belief.dependencies).some(([key, value]) => current[key] !== value);
}
export function remember(relation: Relation, question: Question, observation: Observation): Belief {
  const current = dependencyValues(observation);
  return {
    ...relation,
    evidenceKey: observation.key,
    source: 'inspected',
    dependencies: Object.fromEntries(question.dependencies.map(id => [id, current[id] ?? 'absent'])),
    learnedPly: observation.ply,
  };
}
export class BeliefLedger {
  private readonly entries = new Map<string, Belief>();
  constructor(
    beliefs: readonly Belief[],
    private readonly capacity: number,
  ) {
    for (const belief of beliefs.slice(-capacity))
      this.entries.set(belief.question, { ...belief, source: 'remembered' });
  }
  values(): Belief[] {
    return [...this.entries.values()];
  }
  get(id: string): Belief | undefined {
    return this.entries.get(id);
  }
  put(belief: Belief): void {
    this.entries.delete(belief.question);
    this.entries.set(belief.question, belief);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}
export class RetrievalLedger {
  private readonly records = new Map<string, Retrieval>();
  constructor(
    private readonly profile: CompiledProfile,
    private readonly episode: string,
  ) {}
  retrieve(
    binding: Binding,
    revision: string,
    focusEpoch: number,
    goal?: string,
    sessionOffset = 0,
  ): Retrieval {
    const key = `${binding.schema}/${binding.key}/${revision}/${focusEpoch}`;
    const existing = this.records.get(key);
    if (existing) return existing;
    const c = this.profile.controls;
    const mastery = c.K03[binding.schema] ?? 'absent';
    const transfer = binding.similarity === 1 ? 0 : 2.5 * (c.K04 - (1 - binding.similarity));
    const activation =
      this.profile.coefficients.activation +
      binding.cue * 1.5 +
      transfer +
      (binding.goal === goal ? 0.9 * c.P01 : 0) +
      (binding.forcing ? 0.3 * c.S01 : 0) +
      (mastery === 'proceduralized' ? 0.8 : mastery === 'understood' ? 0.3 : -0.5) +
      clamp(normal(this.profile.seed, `${this.episode}/${key}/activation`), -2, 2) * 0.35 +
      sessionOffset;
    const accessibility = sigmoid(activation);
    const available =
      mastery !== 'absent' && uniform(this.profile.seed, `${this.episode}/${key}/access`) < accessibility;
    const record: Retrieval = {
      key,
      schema: binding.schema,
      binding: binding.key,
      mastery,
      activation,
      available,
      confidence: available ? clamp(0.35 + 0.5 * accessibility + (mastery === 'recognized' ? -0.15 : 0)) : 0,
      cost: 0.8 + 4.2 * (1 - accessibility),
    };
    this.records.set(key, record);
    return record;
  }
  values(): Retrieval[] {
    return [...this.records.values()];
  }
}
