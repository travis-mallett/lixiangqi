import {
  createMoveTreeFromUciMainline,
  requestXiangqi,
  XiangqiRequestError,
  type RulesState,
  type XiangqiPositionNode,
} from 'xiangqi';

import type { EngineAnalysis, EngineScore, PikafishHistory } from 'lib/ceval/engines/pikafishProtocol';
import { xiangqiMaterialScore as material } from 'lib/game/material';

export { material };

import type { PuzzlePlayback } from './solutions';

// Tactical tolerance and fixed solver-move budgets. Mating deviations also need
// a complete native-rules winning continuation within their remaining budget.
export const puzzleAdjudicationSettings = {
  maximumAdvantageLoss: 0.5,
  playerMoveAllowanceMultiplier: 3,
} as const;

export type PuzzleFailure =
  | 'advantageLost'
  | 'forcedMateLost'
  | 'moveAllowanceExceeded'
  | 'mateExceedsAllowance'
  | 'lineDrawn'
  | 'lineLost';
export type PuzzleDecision =
  | { result: 'win' | 'continue' }
  | { result: 'fail'; reason: PuzzleFailure; needed?: number; remaining?: number };
export interface PuzzleObjective {
  mate: boolean;
  startingCp: number;
  player: 'red' | 'black';
  allowance: number;
  startingMaterial: number;
  targetMaterial: number;
  targetPosition: string;
}

export function playerMoveAllowance(solution: string[], mating = false): number {
  const storedMoves = Math.ceil(solution.length / 2);
  return mating && storedMoves === 2
    ? 4
    : storedMoves * puzzleAdjudicationSettings.playerMoveAllowanceMultiplier;
}

export function hasUsableScore(analysis: EngineAnalysis): boolean {
  const { redCp, redMate, bound } = analysis.score;
  return (
    !bound &&
    ((redCp !== undefined && Number.isFinite(redCp)) || (redMate !== undefined && Number.isFinite(redMate)))
  );
}

export interface WinningContinuation {
  moves: string[];
  finalState: RulesState;
}

// Compare additional solver moves after the submitted move, from the same position.
export function isEfficientMate(remaining: number, score: EngineScore, player: 'red' | 'black'): boolean {
  const mate = playerScore(score, player).mate;
  return mate !== undefined && mate > 0 && mate <= remaining;
}

// A PV is guidance, not a certificate. Replay it once with the same native rules
// and history as playback before retaining it. Insufficient evidence and
// service failures remain unscored evaluation errors.
export async function winningContinuation(
  objective: PuzzleObjective,
  state: RulesState,
  evaluation: EngineAnalysis,
  playerMoves: number,
  history: PikafishHistory,
): Promise<WinningContinuation | undefined> {
  const mate = playerScore(evaluation.score, objective.player).mate;
  const moves = [...(evaluation.lines[0]?.pvMoves ?? [])];
  const solverMoves =
    state.turn === objective.player ? Math.ceil(moves.length / 2) : Math.floor(moves.length / 2);
  if (
    !hasUsableScore(evaluation) ||
    mate === undefined ||
    !Number.isFinite(mate) ||
    mate <= 0 ||
    !moves.length ||
    moves[0] !== evaluation.bestMove ||
    !state.legalMoves.includes(moves[0])
  )
    return;
  try {
    const finalState = await requestXiangqi<RulesState>('/api/analysis/position', {
      initialFen: history.initialFen,
      moves: [...history.moves, ...moves],
    });
    if (terminalDecision(finalState, objective.player, playerMoves + solverMoves, Infinity)?.result === 'win')
      return { moves, finalState };
  } catch (error) {
    if (!(error instanceof XiangqiRequestError && error.status === 400)) throw error;
  }
  return undefined;
}

// A win on the final allowed move counts; a win beyond it does not.
// Authoritative draws/losses must never pass through the scripted-line shortcut.
export function terminalDecision(
  state: RulesState,
  player: 'red' | 'black',
  playerMoves: number,
  allowance: number,
): PuzzleDecision | undefined {
  if (playerMoves > allowance) return { result: 'fail', reason: 'moveAllowanceExceeded' };
  if (state.gameResult === '*') return;
  return state.gameResult === (player === 'red' ? '1-0' : '0-1')
    ? { result: 'win' }
    : { result: 'fail', reason: state.gameResult === '1/2-1/2' ? 'lineDrawn' : 'lineLost' };
}

export function playerScore(score: EngineScore, player: 'red' | 'black'): { cp?: number; mate?: number } {
  const sign = player === 'red' ? 1 : -1;
  return {
    cp: score.redCp === undefined ? undefined : score.redCp * sign,
    mate: score.redMate === undefined ? undefined : score.redMate * sign,
  };
}

export function linePositions(fen: string, moves: string[]): RulesState[] {
  let node: XiangqiPositionNode = createMoveTreeFromUciMainline(fen, moves).root;
  const states = [node.state];
  while (node.children[0]) {
    node = node.children[0];
    states.push(node.state);
  }
  return states;
}

const positionKey = (fen: string): string => fen.split(/\s+/).slice(0, 2).join(' ');

export function makeObjective(
  initialFen: string,
  solution: string[],
  playback: PuzzlePlayback,
): PuzzleObjective {
  if (!solution.length) throw new Error('Puzzle has no stored solution');
  const player = initialFen.split(/\s+/)[1] === 'b' ? 'black' : 'red';
  const mate = playback.objective === 'mate';
  if (playback.objective === 'tactic' && (!Number.isFinite(playback.startingCp) || playback.startingCp! <= 0))
    throw new Error('Puzzle has no verified starting advantage');
  const positions = linePositions(initialFen, solution);
  const end = positions[positions.length - 1];
  return {
    mate,
    startingCp: playback.startingCp ?? 0,
    player,
    allowance: playerMoveAllowance(solution, mate),
    startingMaterial: material(initialFen, player),
    targetMaterial: material(end.fen, player),
    targetPosition: positionKey(end.fen),
  };
}

export function alternativeScoreFailure(
  objective: PuzzleObjective,
  evaluation: EngineAnalysis,
  playerMoves: number,
): Extract<PuzzleDecision, { result: 'fail' }> | undefined {
  if (!hasUsableScore(evaluation)) throw new Error('Pikafish returned no usable score');
  if (objective.mate && playerMoves >= objective.allowance)
    return { result: 'fail', reason: 'moveAllowanceExceeded' };
  const score = playerScore(evaluation.score, objective.player);
  const forcedMate = score.mate !== undefined && score.mate > 0;
  if (objective.mate) {
    if (!forcedMate) return { result: 'fail', reason: 'forcedMateLost' };
    const remaining = objective.allowance - playerMoves;
    if (score.mate! > remaining)
      return { result: 'fail', reason: 'mateExceedsAllowance', needed: score.mate, remaining };
  } else if (
    !forcedMate &&
    (score.cp === undefined ||
      score.cp < objective.startingCp * (1 - puzzleAdjudicationSettings.maximumAdvantageLoss))
  )
    return {
      result: 'fail',
      reason: playerMoves >= objective.allowance ? 'moveAllowanceExceeded' : 'advantageLost',
    };
  return undefined;
}

export function adjudicateAlternative(
  objective: PuzzleObjective,
  state: RulesState,
  evaluation: EngineAnalysis | undefined,
  playerMoves: number,
  continuation?: WinningContinuation,
): PuzzleDecision {
  const terminal = terminalDecision(state, objective.player, playerMoves, objective.allowance);
  if (terminal) return terminal;
  if (!evaluation) throw new Error('Pikafish returned no usable score');
  const failure = alternativeScoreFailure(objective, evaluation, playerMoves);
  if (failure) return failure;
  if (objective.mate) {
    if (!continuation) throw new Error('Pikafish did not establish a complete winning continuation');
    const needed = Math.floor(continuation.moves.length / 2);
    const remaining = objective.allowance - playerMoves;
    if (needed > remaining) return { result: 'fail', reason: 'mateExceedsAllowance', needed, remaining };
    return { result: 'continue' };
  }

  if (!objective.mate && evaluation) {
    const equivalentPosition = positionKey(state.fen) === objective.targetPosition;
    // Require an actual gain, not merely an already-winning starting position.
    // Check the entire reported PV, including the opponent's immediate recapture.
    const pv = evaluation.lines[0]?.pvMoves ?? [];
    const realizedGain =
      objective.targetMaterial > objective.startingMaterial &&
      pv.length > 0 &&
      linePositions(state.fen, pv).every(
        pos => material(pos.fen, objective.player) >= objective.targetMaterial,
      );
    if (equivalentPosition || realizedGain) return { result: 'win' };
  }
  if (playerMoves >= objective.allowance) return { result: 'fail', reason: 'moveAllowanceExceeded' };
  return { result: 'continue' };
}
