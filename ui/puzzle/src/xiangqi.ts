import { replayXiangqiVariation, type RulesState } from 'lib/game/xiangqiNotation';
import { createMoveTreeFromStates } from 'lib/tree/native';
import { completeNode } from 'lib/tree/node';
import { path as pathOps } from 'lib/tree/tree';
import type { TreeNode } from 'lib/tree/types';

import type PuzzleCtrl from './ctrl';
import type { PuzzleData } from './interfaces';

export type XiangqiPuzzleNode = TreeNode & {
  state: RulesState;
  chineseNotation?: string;
};

export function buildSolutionTree({ puzzle }: PuzzleData) {
  const line = puzzle.playback.solutions[0];
  const labels = puzzle.solutionLabels;
  return createMoveTreeFromStates(
    puzzle.solutionStates,
    line,
    line.map((move, i) => labels?.[i]?.notation ?? move),
    labels?.map(m => m.chineseNotation),
    [],
    0,
    puzzle.ruleset,
  );
}

export async function replaySolutionBranch(data: PuzzleData, line: string[], signal: AbortSignal) {
  const { moves } = await replayXiangqiVariation(
    data.game.states[0].fen,
    data.game.moves ?? [],
    data.game.ruleset,
    line,
    signal,
  );
  return createMoveTreeFromStates(
    [data.puzzle.solutionStates[0], ...moves.map(m => m.state)],
    line,
    moves.map(m => m.notation),
    moves.map(m => m.chineseNotation),
    [],
    0,
    data.game.ruleset,
  ).root;
}

export function buildXiangqiTree(data: PuzzleData): XiangqiPuzzleNode {
  return createMoveTreeFromStates(
    data.game.states,
    data.game.moves ?? [],
    data.game.notations ?? [],
    data.game.notationsZh ?? [],
    [],
    0,
    data.game.ruleset,
  ).root;
}

export function makeXiangqiNode(state: RulesState, uci: string, notation: string): XiangqiPuzzleNode {
  return completeNode({ uci, notation, state, fen: state.fen, ply: state.ply, children: [] });
}

export function nextXiangqiMove(ctrl: PuzzleCtrl): string | undefined {
  if (ctrl.mode === 'view' || !pathOps.contains(ctrl.path, ctrl.initialPath)) return;
  return ctrl.nextSolutionMove();
}

export function splitXiangqiUci(uci: string): [string, string] | undefined {
  const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(uci);
  return match ? [match[1], match[2]] : undefined;
}
