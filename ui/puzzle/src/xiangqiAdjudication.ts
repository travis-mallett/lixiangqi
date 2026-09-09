import {
  createMoveTreeFromUciMainline,
  requestXiangqi,
  XiangqiRequestError,
  type RulesState,
  type XiangqiPositionNode,
} from 'xiangqi';

import type { EngineAnalysis, EngineScore, PikafishHistory } from 'lib/ceval/engines/pikafishProtocol';

// Tactical tolerance and fixed solver-move budgets. Mating deviations also need
// a complete native-rules winning continuation within their remaining budget.
export const puzzleAdjudicationSettings = {
  maximumAdvantageLoss: 0.5,
  playerMoveAllowanceMultiplier: 3,
} as const;

export type PuzzleFailure = 'advantageLost' | 'forcedMateLost' | 'moveAllowanceExceeded';
export type PuzzleDecision = { result: 'win' | 'continue' } | { result: 'fail'; reason: PuzzleFailure };
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

// The saved line supplies the local mate distance, including after an accepted
// detour. Only the solver's moves count; the submitted move has already happened.
export function isEfficientMate(
  solution: string[],
  played: string[],
  continuation: WinningContinuation,
  score: EngineScore,
  player: 'red' | 'black',
): boolean {
  const parent = played.slice(0, -1);
  if (parent.some((uci, i) => uci !== solution[i])) return false;
  const remaining = Math.floor((solution.length - played.length) / 2);
  const mate = playerScore(score, player).mate;
  return (
    mate !== undefined &&
    mate > 0 &&
    mate <= remaining &&
    Math.floor(continuation.moves.length / 2) <= remaining
  );
}

// A PV is guidance, not a certificate. Replay it once with the same native rules
// and history as playback before retaining it. Invalid analysis fails the move;
// transport/service failures propagate through the existing evaluation error UI.
export async function winningContinuation(
  objective: PuzzleObjective,
  state: RulesState,
  evaluation: EngineAnalysis,
  playerMoves: number,
  history: PikafishHistory,
): Promise<WinningContinuation | undefined> {
  const mate = playerScore(evaluation.score, objective.player).mate;
  const moves = [...(evaluation.lines[0]?.pvMoves ?? [])];
  const remaining = objective.allowance - playerMoves;
  const solverMoves =
    state.turn === objective.player ? Math.ceil(moves.length / 2) : Math.floor(moves.length / 2);
  if (
    !hasUsableScore(evaluation) ||
    mate === undefined ||
    !Number.isFinite(mate) ||
    mate <= 0 ||
    !moves.length ||
    moves[0] !== evaluation.bestMove ||
    !state.legalMoves.includes(moves[0]) ||
    remaining <= 0 ||
    solverMoves > remaining
  )
    return;
  try {
    const finalState = await requestXiangqi<RulesState>('/api/analysis/position', {
      initialFen: history.initialFen,
      moves: [...history.moves, ...moves],
    });
    if (
      terminalDecision(finalState, objective.player, playerMoves + solverMoves, objective.allowance)
        ?.result === 'win'
    )
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
    : { result: 'fail', reason: 'advantageLost' };
}

export type StoredLineProgress = { kind: 'alternative' | 'win' | 'wait' } | { kind: 'reply'; uci: string };

export function storedLineProgress(solution: string[], played: string[]): StoredLineProgress {
  if (played.some((uci, i) => uci !== solution[i])) return { kind: 'alternative' };
  if (played.length >= solution.length) return { kind: 'win' };
  return played.length % 2 === 1 ? { kind: 'reply', uci: solution[played.length] } : { kind: 'wait' };
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

// Material is only a completion target, never a replacement for Pikafish's evaluation.
// Fixed values deliberately exclude positional bonuses (e.g. crossing the river).
const pieceValues: Record<string, number> = { r: 9, c: 4.5, n: 4, h: 4, b: 2, e: 2, a: 2, p: 1, k: 0 };
export function material(fen: string, player: 'red' | 'black'): number {
  let red = 0;
  for (const piece of fen.split(' ')[0]) {
    const value = pieceValues[piece.toLowerCase()] ?? 0;
    red += piece === piece.toUpperCase() ? value : -value;
  }
  return player === 'red' ? red : -red;
}

export function makeObjective(
  initialFen: string,
  solution: string[],
  starting: EngineAnalysis | undefined,
  matingObjective: boolean,
): PuzzleObjective {
  if (!solution.length) throw new Error('Puzzle has no stored solution');
  if (!matingObjective && (!starting || !hasUsableScore(starting)))
    throw new Error('Pikafish returned no usable starting puzzle score');
  const player = initialFen.split(/\s+/)[1] === 'b' ? 'black' : 'red';
  const score = starting ? playerScore(starting.score, player) : {};
  const mate = matingObjective || (score.mate !== undefined && score.mate > 0);
  if (!mate && (score.cp === undefined || score.cp <= 0))
    throw new Error('Pikafish could not establish a positive starting advantage');
  const positions = linePositions(initialFen, solution);
  const end = positions[positions.length - 1];
  return {
    mate,
    startingCp: score.cp ?? 0,
    player,
    allowance: playerMoveAllowance(solution, mate),
    startingMaterial: material(initialFen, player),
    targetMaterial: material(end.fen, player),
    targetPosition: positionKey(end.fen),
  };
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
  const score = evaluation && playerScore(evaluation.score, objective.player);
  const forcedMate = score?.mate !== undefined && score.mate > 0;
  if (
    objective.mate
      ? !forcedMate
      : !forcedMate &&
        (score?.cp === undefined ||
          score.cp < objective.startingCp * (1 - puzzleAdjudicationSettings.maximumAdvantageLoss))
  )
    return { result: 'fail', reason: objective.mate ? 'forcedMateLost' : 'advantageLost' };

  if (objective.mate) {
    if (playerMoves >= objective.allowance) return { result: 'fail', reason: 'moveAllowanceExceeded' };
    return continuation ? { result: 'continue' } : { result: 'fail', reason: 'forcedMateLost' };
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
