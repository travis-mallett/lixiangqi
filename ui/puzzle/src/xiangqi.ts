import { type XiangqiNotationStyle } from 'lib/game';
import { requestXiangqi } from 'lib/game/xiangqiApi';
import type { RulesState } from 'lib/game/xiangqiNotation';
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

export async function buildSolutionTree(
  data: PuzzleData,
  notationStyle: XiangqiNotationStyle,
  current: () => boolean,
): Promise<XiangqiPuzzleNode | undefined> {
  let initial = buildXiangqiTree(data, notationStyle);
  while (initial.children[0]) initial = initial.children[0];
  const root: XiangqiPuzzleNode = {
    ...initial,
    path: '',
    id: '',
    uci: undefined,
    notation: undefined,
    ruleset: data.game.ruleset,
    children: [],
  };
  for (const line of data.puzzle.playback.solutions) {
    let parent = root;
    for (let index = 0; index < line.length; index++) {
      const uci = line[index];
      let child = parent.children.find(node => node.uci === uci);
      if (!child) {
        const state = await requestXiangqi<RulesState & { notation: string; chineseNotation: string }>(
          '/api/analysis/move',
          {
            initialFen: data.game.initialFen || data.puzzle.displayFen,
            moves: [...(data.game.moves ?? []), ...line.slice(0, index)],
            move: uci,
            ruleset: data.game.ruleset,
          },
        );
        if (!current()) return;
        child = makeXiangqiNode(state, uci, state.notation);
        child.chineseNotation = state.chineseNotation;
        parent.children.push(child);
      }
      parent = child;
    }
  }
  return root;
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
