export const puzzlePresenceInterval = 15_000;

export function startPuzzlePresence(
  announce: () => Promise<unknown>,
  schedule: (callback: () => void, delay: number) => unknown = window.setInterval.bind(window),
): void {
  const heartbeat = () => void announce().catch(() => {});

  heartbeat();
  schedule(heartbeat, puzzlePresenceInterval);
}
