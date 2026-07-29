import type { RulesState } from './tree';

interface ErrorResponse {
  error?: string;
}

/** The shared browser boundary for every Xiangqi rules and engine request. */
export async function requestXiangqi<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
    signal,
  });
  const responseText = await response.text();
  let json: (T & ErrorResponse) | undefined;
  try {
    json = JSON.parse(responseText) as T & ErrorResponse;
  } catch {
    // Upstream failures must not leak a low-level JSON parser exception into
    // board UIs. The status remains the useful part of this failed contract.
  }
  if (!response.ok) throw new Error(json?.error ?? `Native Xiangqi request failed (${response.status})`);
  if (json === undefined) throw new Error('Xiangqi service returned an invalid response');
  return json;
}

/**
 * Replace a locally reconstructed position with authoritative native-rules state.
 *
 * Capture belongs to the transition into the position, so the position endpoint
 * cannot recover it from the destination FEN. Preserve it while replacing all
 * position-derived fields such as check, mate/end state, and legal moves.
 */
export async function hydrateXiangqiState(state: RulesState, signal?: AbortSignal): Promise<RulesState> {
  if (!state.needsHydration) return state;
  const hydrated = await requestXiangqi<RulesState>(
    '/api/analysis/position',
    {
      initialFen: state.fen,
      moves: [],
    },
    signal,
  );
  return { ...hydrated, capture: state.capture };
}
