export interface SelectionEpisode {
  value: string;
  usedMs: number;
}
export type SelectionEpisodes = Record<string, SelectionEpisode>;

export function readSelections(value: unknown): SelectionEpisodes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, episode]) =>
        episode &&
        typeof episode.value === 'string' &&
        Number.isFinite(episode.usedMs) &&
        episode.usedMs >= 0 &&
        episode.usedMs <= 1_000_000_000_000,
    ),
  );
}

/** A small browser-local accumulator; only observed foreground usage counts. */
export function addSelectionTime(
  episodes: SelectionEpisodes,
  choices: Record<string, string>,
  elapsed: Record<string, number>,
): void {
  for (const [component, value] of Object.entries(choices)) {
    if (episodes[component]?.value !== value) episodes[component] = { value, usedMs: 0 };
    const amount = component === 'board' || component === 'pieces' ? elapsed.boardMs : elapsed.engagedMs;
    episodes[component].usedMs = Math.min(1_000_000_000_000, episodes[component].usedMs + (amount || 0));
  }
}

export function finishSelection(
  episodes: SelectionEpisodes,
  component: string,
  previous: string,
  next: string,
): number | undefined {
  const episode = episodes[component];
  const usedMs = episode?.value === previous ? episode.usedMs : undefined;
  episodes[component] = { value: next, usedMs: 0 };
  return usedMs;
}
