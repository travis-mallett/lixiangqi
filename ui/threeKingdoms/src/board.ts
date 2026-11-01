import type { BoardPosition, BoardTransition, BoardInteraction } from '@lixiangqi/board';

import { boardInput, type BoardPreferences } from 'lib/board';

import type { State, Color } from './types';

export function position(state: State): BoardPosition {
  return {
    board: 'threeKingdoms',
    active: state.turn,
    pieces: new Map(
      state.pieces.map(p => [
        p.location,
        { face: 'up', participant: p.army, role: p.role, controller: p.controller, inactive: p.fallen },
      ]),
    ),
    lastMove: state.lastMove?.split('>') as [string, string] | undefined,
    checked: state.pieces
      .filter(p => p.role === 'general' && state.checked.includes(p.army))
      .map(p => p.location),
  };
}

export function interaction(
  state: State,
  move: (key: string) => void,
  player: Color | undefined,
  preferences: BoardPreferences = {},
): BoardInteraction {
  if (!player || state.ending || state.turn !== player) return { mode: 'display' };
  const destinations = new Map<string, string[]>();
  for (const key of state.moves) {
    const [from, to] = key.split('>');
    destinations.set(from, [...(destinations.get(from) ?? []), to]);
  }
  return {
    mode: 'play',
    participant: player,
    destinations,
    input: boardInput(preferences),
    showDestinations: true,
    onMove: ({ from, to }) => move(`${from}>${to}`),
  };
}

export function transition(before: State, after: State, id: string): BoardTransition {
  const moved = movedBetween(before, after);
  const captured = moved && before.pieces.find(p => p.location === moved.split('>')[1]);
  const movingArmy = moved && before.pieces.find(p => p.location === moved.split('>')[0])?.army;
  // Check markers describe the position; feedback announces only newly established checks.
  // The third player's intervening move must not announce an unchanged opponent's check again.
  const checks = moved
    ? after.checked.filter(
        target =>
          !before.checked.includes(target) ||
          after.checkSources?.[target]?.some(source => !before.checkSources?.[target]?.includes(source)),
      )
    : [];
  const eliminated = after.eliminated.filter(
    e => !before.eliminated.some(previous => previous.player === e.player),
  );
  return {
    kind: moved ? 'forward' : 'confirmation',
    id,
    effects: [
      ...(captured ? ['capture' as const] : []),
      ...(checks.length ? ['check' as const] : []),
      ...(eliminated.some(e => ['capture', 'checkmate', 'stalemate'].includes(e.reason))
        ? ['checkmate' as const]
        : []),
      ...(eliminated.some(e => !['capture', 'checkmate', 'stalemate'].includes(e.reason))
        ? ['defeat' as const]
        : []),
    ],
    effectTargets: {
      capture: captured ? [captured.army] : [],
      check: checks,
      checkmate: eliminated
        .filter(e => ['capture', 'checkmate', 'stalemate'].includes(e.reason))
        .map(e => e.player),
      defeat: eliminated
        .filter(e => !['capture', 'checkmate', 'stalemate'].includes(e.reason))
        .map(e => e.player),
    },
    effectRoutes: {
      capture: captured && moved ? [[movingArmy!, captured.army]] : [],
      check: checks.flatMap(target => {
        const sources = (after.checkSources?.[target] ?? []).filter(
          source => !before.checked.includes(target) || !before.checkSources?.[target]?.includes(source),
        );
        const source = movingArmy && sources.includes(movingArmy) ? movingArmy : sources[0];
        return source ? [[source, target] as const] : [];
      }),
    },
    winners: after.ending && !after.ending.draw && !before.ending ? after.ending.winners : [],
  };
}

function movedBetween(before: State, after: State): string | undefined {
  if (after.ply !== before.ply + 1 || !after.lastMove) return;
  const [from, to] = after.lastMove.split('>');
  return before.pieces.some(piece => piece.location === from) &&
    !after.pieces.some(piece => piece.location === from) &&
    after.pieces.some(piece => piece.location === to)
    ? after.lastMove
    : undefined;
}

/** Navigation supplies adjacency; ply alone cannot distinguish sibling variations or non-move events. */
export function playbackTransition(
  before: State,
  after: State,
  direction: 'forward' | 'backward' | 'jump',
  id: string,
): BoardTransition {
  if (direction === 'forward') return transition(before, after, id);
  if (direction === 'backward' && movedBetween(after, before)) return { kind: 'backward', id, effects: [] };
  return { kind: 'jump' };
}
