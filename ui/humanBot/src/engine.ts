import { clamp } from './random';
import type { EngineEvidence, EngineLine, EngineQuery, Observation, Player } from './types';

export function engineValue(line: EngineLine, player: Player): number {
  const outcome = line.forced?.[player];
  if (outcome === undefined) return line.utilities[player];
  if (outcome === 0) return 0;
  // Known wins/losses dominate every finite style preference; prefer shorter wins,
  // longer resistance. Ranked outcomes keep their placement utility.
  return Math.sign(outcome) * (100 + 900 * Math.abs(outcome) - Math.min(50, line.distance ?? 0) * 0.01);
}

export function validateEvidence<P>(
  evidence: EngineEvidence,
  query: EngineQuery<P>,
  observation: Observation,
  version: string,
): void {
  if (
    evidence.version !== version ||
    evidence.observation !== observation.key ||
    !Number.isFinite(evidence.nodes) ||
    evidence.nodes < 0 ||
    !Number.isFinite(evidence.elapsedMs) ||
    evidence.elapsedMs < 0 ||
    !evidence.lines.length ||
    evidence.lines.length > query.multiPv ||
    new Set(evidence.lines.map(line => line.action)).size !== evidence.lines.length ||
    evidence.bestAction !== evidence.lines[0].action ||
    (evidence.unscoredBest !== undefined && !query.actions.includes(evidence.unscoredBest))
  )
    throw new Error(
      `Invalid or mismatched engine evidence: ${JSON.stringify({
        version: evidence.version,
        expectedVersion: version,
        observation: evidence.observation,
        expectedObservation: observation.key,
        nodes: evidence.nodes,
        elapsedMs: evidence.elapsedMs,
        count: evidence.lines.length,
        width: query.multiPv,
        best: evidence.bestAction,
        first: evidence.lines[0]?.action,
        unique: new Set(evidence.lines.map(line => line.action)).size,
      })}`,
    );
  for (const line of evidence.lines) {
    if (
      !query.actions.includes(line.action) ||
      !observation.moves.some(move => move.action === line.action) ||
      line.pv[0] !== line.action ||
      !Number.isFinite(line.depth) ||
      line.depth < 0 ||
      !Number.isFinite(line.uncertainty) ||
      line.uncertainty < 0 ||
      line.uncertainty > 1 ||
      (line.distance !== undefined && (!Number.isFinite(line.distance) || line.distance < 0))
    )
      throw new Error('Engine supplied an invalid action or line');
    for (const player of observation.players) {
      if (
        !Number.isFinite(line.utilities[player]) ||
        Math.abs(line.utilities[player]) > 100 ||
        (line.forced && (!Number.isFinite(line.forced[player]) || Math.abs(line.forced[player]) > 1))
      )
        throw new Error('Engine omitted a player utility or supplied an invalid score');
    }
  }
}

/** Quality envelope is intrinsic to choice, not a blunder repair after selection. */
export function credibleLines(lines: readonly EngineLine[], player: Player, band: number): EngineLine[] {
  const best = Math.max(...lines.map(line => engineValue(line, player)));
  return lines.filter(line => engineValue(line, player) >= best - clamp(band, 0, 2));
}
