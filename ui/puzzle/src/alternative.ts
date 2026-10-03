import type { RulesState } from 'xiangqi';

import type { EngineAnalysis, PikafishHistory } from 'lib/ceval/engines/pikafishProtocol';
import { replayXiangqiVariation } from 'lib/game/xiangqiNotation';

import {
  adjudicateAlternative,
  alternativeScoreFailure,
  hasUsableScore,
  playerScore,
  winningContinuation,
  type PuzzleDecision,
  type PuzzleObjective,
  type WinningContinuation,
} from './xiangqiAdjudication';
import { type default as XiangqiPuzzleEngine, XIANGQI_PUZZLE_CONFIRM_DEPTH } from './xiangqiPuzzleEngine';

export interface AlternativeResult {
  evaluation: EngineAnalysis;
  continuation?: WinningContinuation;
  decision: PuzzleDecision;
}

function needsDeeperSearch(objective: PuzzleObjective, decision: PuzzleDecision, depth: number): boolean {
  return (
    decision.result === 'fail' &&
    (['forcedMateLost', 'mateExceedsAllowance', 'advantageLost'].includes(decision.reason) ||
      (!objective.mate && decision.reason === 'moveAllowanceExceeded')) &&
    depth < XIANGQI_PUZZLE_CONFIRM_DEPTH
  );
}

/** Inspect the running search at four and six seconds. Only a still-shallow
 * adverse result needs the longer confirmation budget; all search stays continuous. */
export async function evaluateAlternative(
  engine: XiangqiPuzzleEngine,
  objective: PuzzleObjective,
  state: RulesState,
  playerMoves: number,
  history: PikafishHistory,
  current: () => boolean,
  onProgress?: (analysis: EngineAnalysis) => void,
): Promise<AlternativeResult | undefined> {
  const searchDecision = (analysis: EngineAnalysis): PuzzleDecision | undefined => {
    if (!hasUsableScore(analysis)) return;
    try {
      return objective.mate
        ? (alternativeScoreFailure(objective, analysis, playerMoves) ?? { result: 'continue' })
        : adjudicateAlternative(objective, state, analysis, playerMoves);
    } catch {
      // Incomplete intermediate evidence can improve with more search. Final
      // adjudication still reports invalid or unverifiable analysis as unscored.
      return undefined;
    }
  };
  const evaluation = await engine.evaluate(
    state.fen,
    history,
    {
      extend: analysis => {
        const decision = searchDecision(analysis);
        return current() && (!decision || decision.result === 'fail');
      },
      needsConfirmation: analysis => {
        const decision = searchDecision(analysis);
        return current() && !!decision && needsDeeperSearch(objective, decision, analysis.depth);
      },
    },
    onProgress,
  );
  if (!current()) return;
  const decide = async (): Promise<AlternativeResult> => {
    if (!hasUsableScore(evaluation)) throw new Error('Pikafish returned no usable puzzle score');
    const mate = playerScore(evaluation.score, objective.player).mate;
    const continuation =
      objective.mate && mate !== undefined && mate > 0 && mate <= objective.allowance - playerMoves
        ? await winningContinuation(objective, state, evaluation, playerMoves, history)
        : undefined;
    const pv = evaluation.lines[0]?.pvMoves ?? [];
    const variationStates =
      objective.mate || !pv.length
        ? undefined
        : (await replayXiangqiVariation(history.initialFen, history.moves, history.ruleset!, pv)).moves.map(
            move => move.state,
          );
    return {
      evaluation,
      continuation,
      decision: adjudicateAlternative(
        objective,
        state,
        evaluation,
        playerMoves,
        continuation,
        variationStates,
      ),
    };
  };
  const result = await decide();
  // Depth 20 is a search target, not a requirement for using the deadline result.
  return current() ? result : undefined;
}
