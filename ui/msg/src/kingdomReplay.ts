import type { ViewerNode } from '@lixiangqi/viewer';
import { loadRules, position, transition, type Rules } from 'threeKingdoms';

import type { MessageBoard } from './boardContent';

export function kingdomReplay(board: MessageBoard, rules: Rules): ViewerNode {
  let root: ViewerNode | undefined;
  let parent: ViewerNode | undefined;
  let previous: ReturnType<typeof rules.inspect> | undefined;
  for (const frame of board.frames) {
    const state = rules.inspect(frame.fen);
    const id = String(frame.ply);
    const node: ViewerNode = {
      id,
      fen: frame.fen,
      ply: frame.ply,
      position: position(state),
      move: frame.move,
      label: frame.move ?? '',
      comments: [],
      hasAnnotation: !!frame.shapes.length,
      effects: previous ? [...(transition(previous, state, id).effects ?? [])] : [],
      marks: frame.shapes.map(shape => ({ from: shape.orig, to: shape.dest, brush: shape.brush })),
      parent,
      children: [],
    };
    root ??= node;
    parent?.children.push(node);
    parent = node;
    previous = state;
  }
  return root!;
}

export async function loadKingdomReplay(board: MessageBoard): Promise<ViewerNode> {
  return kingdomReplay(board, await loadRules());
}
