import type { LobbyData } from './interfaces';

export function applyCounterSnapshot(
  data: LobbyData,
  snapshot: { members: number; rounds: number; poolCounts: Record<string, number> },
): void {
  data.counters.members = snapshot.members;
  data.counters.rounds = snapshot.rounds;
  data.poolCounts = snapshot.poolCounts;
}
