import { Result } from '@badrap/result';
import {
  createMoveTreeFromUciMainline,
  createMoveTree,
  addOrSelectChild,
  type RulesState,
  type XiangqiPositionNode,
  type XiangqiTreeNode,
  requestXiangqi,
} from 'xiangqi';

import { selectXiangqiNotation, type XiangqiNotationStyle } from 'lib/game';
import { xiangqiTreeDestinations } from 'lib/tree/node';
import { path as pathOps } from 'lib/tree/tree';
import type { TreeNode } from 'lib/tree/types';

import type PuzzleCtrl from './ctrl';
import type { PuzzleData } from './interfaces';

export type XiangqiPuzzleNode = TreeNode & {
  xiangqi: RulesState;
  wxfNotation?: string;
  chineseNotation?: string;
};

/** Adapt the puzzle's path encoding to the shared Xiangqi notation viewer. */
export function puzzleNotationTree(initialNode: TreeNode, initialPath: string) {
  const tree = createMoveTree((initialNode as XiangqiPuzzleNode).xiangqi);
  const paths = new Map<string, string>([['', initialPath]]);
  const append = (source: TreeNode, target: XiangqiPositionNode, path: string): void => {
    for (const child of source.children as XiangqiPuzzleNode[]) {
      const added = addOrSelectChild(tree, target.path, {
        uci: child.uci!,
        notation: child.san ?? child.uci!,
        wxfNotation: child.wxfNotation ?? child.san,
        chineseNotation: child.chineseNotation,
        state: child.xiangqi,
      });
      paths.set(added.path, path + child.id);
      append(child, tree.byPath.get(added.path)!, path + child.id);
    }
  };
  append(initialNode, tree.root, initialPath);
  return { tree, paths };
}

export async function buildSolutionTree(
  data: PuzzleData,
  notationStyle: XiangqiNotationStyle,
  current: () => boolean,
): Promise<XiangqiPuzzleNode | undefined> {
  let initial = buildXiangqiTree(data, notationStyle);
  while (initial.children[0]) initial = initial.children[0] as XiangqiPuzzleNode;
  const root: XiangqiPuzzleNode = { ...initial, id: '', uci: undefined, san: undefined, children: [] };
  for (const line of data.puzzle.playback.solutions) {
    let parent = root;
    for (let index = 0; index < line.length; index++) {
      const uci = line[index];
      let child = parent.children.find(node => node.uci === uci) as XiangqiPuzzleNode | undefined;
      if (!child) {
        const state = await requestXiangqi<RulesState & { notation: string; chineseNotation: string }>(
          '/api/analysis/move',
          {
            initialFen: data.game.initialFen || data.puzzle.displayFen,
            moves: [...(data.game.moves ?? []), ...line.slice(0, index)],
            move: uci,
          },
        );
        if (!current()) return;
        child = makeXiangqiNode(
          state,
          uci,
          selectXiangqiNotation(state.notation, state.chineseNotation, notationStyle) || uci,
          parent.children.length,
        );
        child.wxfNotation = state.notation;
        child.chineseNotation = state.chineseNotation;
        parent.children.push(child);
      }
      parent = child;
    }
  }
  return root;
}

const unavailablePosition = () => Result.err(new Error('Xiangqi positions are provided by Pikafish'));

function asPuzzleNode(source: XiangqiPositionNode): XiangqiPuzzleNode {
  const move = source.id === 'root' ? undefined : (source as XiangqiTreeNode);
  const node = {
    id: source.id === 'root' ? '' : source.id,
    ply: source.state.ply,
    fen: source.state.fen,
    uci: move?.uci,
    san: move?.notation,
    children: source.children.map(asPuzzleNode),
    pos: unavailablePosition,
    dests: () => xiangqiTreeDestinations(source.state.legalMoves),
    drops: () => [],
    check: () => source.state.check,
    outcome: () => undefined,
    xiangqi: source.state,
  };
  return node;
}

export function buildXiangqiTree(data: PuzzleData, notationStyle: XiangqiNotationStyle): XiangqiPuzzleNode {
  const initialFen = data.game.initialFen || data.puzzle.displayFen;
  if (!initialFen) throw new Error('Xiangqi puzzle is missing its initial position');
  const notations = data.game.notations?.map((notation, index) =>
    selectXiangqiNotation(notation, data.game.notationsZh?.[index], notationStyle),
  );
  const source = createMoveTreeFromUciMainline(initialFen, data.game.moves || [], notations || []);
  const root = asPuzzleNode(source.root);
  let current = root;
  while (current.children[0]) current = current.children[0] as XiangqiPuzzleNode;
  if (data.puzzle.state) {
    current.xiangqi = data.puzzle.state;
    current.fen = data.puzzle.state.fen;
    current.ply = data.puzzle.state.ply;
    current.dests = () => xiangqiTreeDestinations(data.puzzle.state!.legalMoves);
    current.check = () => data.puzzle.state!.check;
  }
  return root;
}

export function makeXiangqiNode(
  state: RulesState,
  uci: string,
  notation: string,
  siblingIndex: number,
): XiangqiPuzzleNode {
  const id = `x${String.fromCharCode(65 + siblingIndex)}`;
  return {
    id,
    ply: state.ply,
    fen: state.fen,
    uci,
    san: notation,
    children: [],
    pos: unavailablePosition,
    dests: () => xiangqiTreeDestinations(state.legalMoves),
    drops: () => [],
    check: () => state.check,
    outcome: () => undefined,
    xiangqi: state,
  };
}

export function nextXiangqiMove(ctrl: PuzzleCtrl): string | undefined {
  if (ctrl.mode === 'view' || !pathOps.contains(ctrl.path, ctrl.initialPath)) return;
  return ctrl.nextSolutionMove();
}

export function splitXiangqiUci(uci: string): [string, string] | undefined {
  const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(uci);
  return match ? [match[1], match[2]] : undefined;
}
