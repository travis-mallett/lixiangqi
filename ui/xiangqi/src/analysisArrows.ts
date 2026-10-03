import { coordinateMove, type BoardMark } from '@lixiangqi/board';

import { engineArrowMoves, moveArrowShape, recommendedArrowShapes } from './recommendedArrows';

/**
 * Every arrow an analysis board draws from engine and navigation state. The
 * analysis page, studies and relays all render through this module, so the
 * vocabulary cannot drift between them.
 */
export interface AnalysisBoardArrowState {
  /** Engine MultiPV lines, most preferred first. */
  readonly engineLines: readonly (readonly string[])[];
  /** Side to move. */
  readonly turn: 'red' | 'black';
  /** Board perspective. */
  readonly orientation: 'red' | 'black';
  /** Continuations of the current position, in display order. */
  readonly children?: readonly string[];
  /** Move currently previewed by an explorer or engine hover. */
  readonly previewMove?: string;
  /** Threat-mode replies. */
  readonly threatMoves?: readonly string[];
}

/** Support arrows keep the lichess colour meanings in the shared arrow style. */
const PREVIEW_COLOR = '#003088';
const VARIATION_COLOR = '#4a4a4a';
const THREAT_COLOR = '#882020';
const SUPPORT_OPACITY = 0.6;
/** A lone continuation is the main line; only alternatives earn variation arrows. */
const MIN_VARIATION_ARROWS = 2;
const MAX_VARIATION_ARROWS = 5;
const MOVE_PATTERN = /^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$/;

export function analysisBoardArrows(state: AnalysisBoardArrowState): BoardMark[] {
  // Painted in this order, so the numbered engine lines and the move under the
  // cursor stay on top of the fainter support arrows.
  const engineMoves = new Set(engineArrowMoves(state.engineLines));
  const children = dedupe(state.children ?? []).filter(move => !engineMoves.has(move));
  const arrows: BoardMark[] = [];
  if (children.length >= MIN_VARIATION_ARROWS)
    arrows.push(
      ...supportArrows(children.slice(0, MAX_VARIATION_ARROWS), VARIATION_COLOR, state.orientation),
    );
  arrows.push(...supportArrows(state.threatMoves, THREAT_COLOR, state.orientation));
  arrows.push(...recommendedArrowShapes(state.engineLines, state.turn, state.orientation));
  if (state.previewMove) arrows.push(...supportArrows([state.previewMove], PREVIEW_COLOR, state.orientation));
  return arrows;
}

function supportArrows(
  moves: readonly string[] | undefined,
  color: string,
  orientation: 'red' | 'black',
): BoardMark[] {
  return (moves ?? []).flatMap(move => {
    if (!MOVE_PATTERN.test(move)) return [];
    const [from, to] = coordinateMove(move);
    return [moveArrowShape(from, to, orientation, { color, opacity: SUPPORT_OPACITY })];
  });
}

function dedupe(moves: readonly string[]): string[] {
  return [...new Set(moves)];
}
