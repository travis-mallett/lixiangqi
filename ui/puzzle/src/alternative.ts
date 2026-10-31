import type { RulesState } from 'xiangqi';

import type { EngineAnalysis, PikafishHistory } from 'lib/ceval/engines/pikafishProtocol';
import { replayXiangqiVariation } from 'lib/game/xiangqiNotation';

import {
  adjudicateAlternative,
  hasUsableScore,
  playerScore,
  winningContinuation,
  type PuzzleDecision,
  type PuzzleObjective,
  type WinningContinuation,
} from './xiangqiAdjudication';
import type XiangqiPuzzleEngine from './xiangqiPuzzleEngine';

export interface AlternativeResult {
  evaluation: EngineAnalysis;
  continuation?: WinningContinuation;
  decision: PuzzleDecision;
}

export async function evaluateAlternative(
  engine: XiangqiPuzzleEngine,
  objective: PuzzleObjective,
  state: RulesState,
  playerMoves: number,
  history: PikafishHistory,
  current: () => boolean,
  onProgress?: (analysis: EngineAnalysis) => void,
): Promise<AlternativeResult | undefined> {
  const evaluation = await engine.evaluate(state.fen, history, onProgress);
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
  return current() ? result : undefined;
}
