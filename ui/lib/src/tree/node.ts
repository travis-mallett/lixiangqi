import { moveDestinations } from '@lixiangqi/board';

import type { RulesState } from '../game/xiangqiNotation';
import { ids, append } from './path';
import type { Outcome, TreeNode, TreeNodeBase } from './types';

/** Rules state is produced by replaying root FEN and the branch history at the native rules boundary. */
export function completeNode(from: TreeNodeBase, parentPath = ''): TreeNode {
  const node = from as TreeNode;
  if (node.uci) {
    if (ids(node.uci).length !== 1) throw new Error('Invalid Xiangqi move identity');
    if (node.id && node.id !== node.uci)
      throw new Error('Tree move identity differs from its coordinate move');
    node.id = node.uci;
  } else node.id = '';
  if (!node.state || node.state.fen !== node.fen || node.state.ply !== node.ply)
    throw new Error('Tree position is missing its native rules state');
  if (
    !Number.isSafeInteger(node.ply) ||
    node.ply < 0 ||
    !['red', 'black'].includes(node.state.turn) ||
    !Array.isArray(node.state.legalMoves)
  )
    throw new Error('Invalid native tree position');
  for (const move of node.state.legalMoves)
    if (ids(move).length !== 1) throw new Error('Invalid legal Xiangqi move');
  if (node.glyphs?.some(glyph => !Number.isInteger(glyph.id) || glyph.id < 0 || glyph.id > 255))
    throw new Error('Invalid annotation symbol');
  if (
    node.shapes?.some(
      shape =>
        !/^[a-i](?:10|[1-9])$/.test(shape.orig) ||
        (shape.dest !== undefined && !/^[a-i](?:10|[1-9])$/.test(shape.dest)),
    )
  )
    throw new Error('Invalid Xiangqi annotation location');
  if (
    [node.clock, node.elapsed].some(time => time !== undefined && (!Number.isSafeInteger(time) || time < 0))
  )
    throw new Error('Invalid clock annotation');
  node.path = node.id ? append(parentPath, node.id) : parentPath;
  node.children ||= [];
  if (new Set(node.children.map(child => child.uci)).size !== node.children.length)
    throw new Error('Duplicate tree branch');
  node.dests = () => moveDestinations(node.state.legalMoves);
  node.check = () => node.state.check;
  node.outcome = () => xiangqiOutcome(node.state);
  node.children.forEach(child => {
    if (!child.uci || child.ply !== node.ply + 1) throw new Error('Invalid Xiangqi branch');
    completeNode(child, node.path);
  });
  return node;
}

export function xiangqiOutcome(state: RulesState): Outcome | undefined {
  switch (state.gameResult) {
    case '1-0':
      return { winner: 'red' };
    case '0-1':
      return { winner: 'black' };
    case '1/2-1/2':
      return {};
    default:
      return undefined;
  }
}
export const xiangqiTreeDestinations: typeof moveDestinations = moveDestinations;
