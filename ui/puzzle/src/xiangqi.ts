import { Result } from '@badrap/result';
import {
  createMoveTreeFromUciMainline,
  legalMoveDests,
  type RulesState,
  type XiangqiPositionNode,
  type XiangqiTreeNode,
} from 'xiangqi';

import { selectXiangqiNotation, type XiangqiNotationStyle } from 'lib/game';
import { path as pathOps } from 'lib/tree/tree';
import type { TreeNode } from 'lib/tree/types';

import type PuzzleCtrl from './ctrl';
import type { PuzzleData, XiangqiMoveTest } from './interfaces';

export type XiangqiPuzzleNode = TreeNode & { xiangqi: RulesState };

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
    dests: () => legalMoveDests(source.state.legalMoves) as Dests,
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
    current.dests = () => legalMoveDests(data.puzzle.state!.legalMoves) as Dests;
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
  const id = `x${String.fromCharCode(65 + (siblingIndex % 26))}`;
  return {
    id,
    ply: state.ply,
    fen: state.fen,
    uci,
    san: notation,
    children: [],
    pos: unavailablePosition,
    dests: () => legalMoveDests(state.legalMoves) as Dests,
    drops: () => [],
    check: () => state.check,
    outcome: () => undefined,
    xiangqi: state,
  };
}

export function xiangqiMoveTest(ctrl: PuzzleCtrl): undefined | 'fail' | 'win' | XiangqiMoveTest {
  if (ctrl.mode === 'view' || !pathOps.contains(ctrl.path, ctrl.initialPath)) return;
  const played = ctrl.nodeList.slice(pathOps.size(ctrl.initialPath) + 1).map(node => node.uci as string);

  for (let i = 0; i < played.length; i++) {
    if (played[i] !== ctrl.data.puzzle.solution[i]) return (ctrl.node.puzzle = 'fail');
  }
  if (played.length >= ctrl.data.puzzle.solution.length) return (ctrl.node.puzzle = 'win');

  // The solver moves first. After each solver move, play the forced reply.
  if (played.length % 2 === 1) {
    ctrl.node.puzzle = 'good';
    return {
      uci: ctrl.data.puzzle.solution[played.length],
      path: ctrl.path,
    };
  }
  return undefined;
}

export function nextXiangqiMove(ctrl: PuzzleCtrl): string | undefined {
  if (ctrl.mode === 'view' || !pathOps.contains(ctrl.path, ctrl.initialPath)) return;
  const played = ctrl.nodeList.length - pathOps.size(ctrl.initialPath) - 1;
  return ctrl.data.puzzle.solution[played];
}

export function splitXiangqiUci(uci: string): [string, string] | undefined {
  const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(uci);
  return match ? [match[1], match[2]] : undefined;
}
