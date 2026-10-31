import { type XiangqiNotationStyle } from 'lib/game';
import { replayXiangqiVariation, type RulesState } from 'lib/game/xiangqiNotation';
import { addOrSelectChild, createMoveTree, createMoveTreeFromStates } from 'lib/tree/native';
import { completeNode } from 'lib/tree/node';
import { path as pathOps } from 'lib/tree/tree';
import type { TreeNode } from 'lib/tree/types';

import type PuzzleCtrl from './ctrl';
import type { PuzzleData } from './interfaces';

export type XiangqiPuzzleNode = TreeNode & {
  state: RulesState;
  chineseNotation?: string;
};

export async function buildSolutionTree(
  data: PuzzleData,
  notationStyle: XiangqiNotationStyle,
  current: () => boolean,
  signal?: AbortSignal,
): Promise<XiangqiPuzzleNode | undefined> {
  let initial = buildXiangqiTree(data, notationStyle);
  while (initial.children[0]) initial = initial.children[0];
  const tree = createMoveTree(initial.state, data.game.ruleset);
  for (const line of data.puzzle.playback.solutions) {
    const replay = await replayXiangqiVariation(
      data.game.states[0].fen,
      data.game.moves ?? [],
      data.game.ruleset,
      line,
      signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    );
    if (!current()) return;
    let path = '';
    for (let index = 0; index < line.length; index++) {
      const move = replay.moves[index];
      path = addOrSelectChild(tree, path, {
        uci: line[index],
        state: move.state,
        notation: move.notation,
        chineseNotation: move.chineseNotation,
      }).path;
    }
  }
  return tree.root;
}

export function buildXiangqiTree(data: PuzzleData, _notationStyle: XiangqiNotationStyle): XiangqiPuzzleNode {
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
