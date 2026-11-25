import {
  positionFromFen,
  coordinateMove,
  boardDefinitionForFen,
  type BoardPosition,
  type BoardEffect,
  type BoardMark,
} from '@lixiangqi/board';

import { XIANGQI_START_FEN } from 'lib/game/xiangqi';
import { importXiangqiNotation, notationAnnotations, type ImportedMoveTree } from 'lib/game/xiangqiNotation';
import { importedTree } from 'lib/tree/native';
import type { TreeNode } from 'lib/tree/types';

export interface ViewerNode {
  node?: TreeNode;
  id: string;
  ply: number;
  position: BoardPosition;
  fen: string;
  move?: string;
  label: string;
  comments: string[];
  hasAnnotation: boolean;
  effects: BoardEffect[];
  marks: BoardMark[];
  parent?: ViewerNode;
  children: ViewerNode[];
}

export interface ViewerSource {
  root?: ViewerNode;
  initialFen?: string;
  moves?: string[];
  pgn?: string;
  tree?: ImportedMoveTree;
  caption?: string;
  initialPly?: number | 'last';
  annotations?: Record<string, string>;
  marks?: { circles?: string[]; squares?: string[] };
}

export function importedViewerTree(tree: ImportedMoveTree, source: ViewerSource = {}): ViewerNode {
  return viewerNode(importedTree(tree), tree.state.ply, source);
}

/** A presentation projection retains its canonical tree node and native path. */
export function viewerNode(
  native: TreeNode,
  rootPly: number,
  source: ViewerSource = {},
  parent?: ViewerNode,
): ViewerNode {
  const state = native.state;
  const move = native.uci;
  const label =
    (document.documentElement.lang.startsWith('zh')
      ? native.chineseNotation || native.notation
      : native.notation) ?? '';
  const position = positionFromFen(state.fen, boardDefinitionForFen(state.fen));
  const annotations = notationAnnotations([source.annotations?.[String(state.ply - rootPly)] ?? '']);
  const comments = [...(native.comments?.map(comment => comment.text) ?? []), ...annotations.comments];
  const node: ViewerNode = {
    node: native,
    id: native.path,
    ply: state.ply,
    fen: state.fen,
    move,
    label: label + (native.glyphs ?? []).map(glyph => glyph.symbol).join(''),
    position: {
      ...position,
      lastMove: move ? coordinateMove(move) : undefined,
      checked: state.check
        ? [...position.pieces]
            .filter(
              ([, piece]) =>
                piece.face === 'up' && piece.role === 'general' && piece.participant === position.active,
            )
            .map(([key]) => key)
        : [],
    },
    comments,
    hasAnnotation: !!(comments.length || native.shapes?.length || annotations.marks.length),
    effects: [
      ...(state.capture ? ['capture' as const] : []),
      ...(state.check ? ['check' as const] : []),
      ...(state.checkmate ? ['checkmate' as const] : []),
    ],
    marks: [
      ...(native.shapes ?? []).map(shape => ({ from: shape.orig, to: shape.dest, brush: shape.brush })),
      ...annotations.marks,
      ...(source.marks?.circles ?? []).map(from => ({ from, brush: 'blue' })),
      ...(source.marks?.squares ?? []).map(from => ({
        from,
        svg: '<rect x="8" y="8" width="84" height="84" rx="6" fill="none" stroke="#e6b422" stroke-width="6" />',
      })),
    ],
    parent,
    children: [],
  };
  node.children = native.children.map(child => viewerNode(child, rootPly, source, node));
  return node;
}

export async function loadViewerTree(source: ViewerSource, signal?: AbortSignal): Promise<ViewerNode> {
  if (source.root) return source.root;
  if (source.tree) return importedViewerTree(source.tree, source);
  if (
    source.moves !== undefined &&
    (!Array.isArray(source.moves) ||
      source.moves.length > 2000 ||
      source.moves.some(
        move => typeof move !== 'string' || !/^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$/.test(move),
      ))
  )
    throw new Error('Invalid recorded Xiangqi moves');
  // A diagram is a visible placement, not a claim that this is a legal game position.
  // In particular, teaching diagrams may intentionally omit both generals.
  if (source.pgn === undefined && !source.moves?.length) {
    const fen = source.initialFen || XIANGQI_START_FEN;
    const fields = fen.trim().split(/\s+/);
    const fullmove = Number(fields[5] || 1);
    const ply =
      (Number.isSafeInteger(fullmove) && fullmove > 0 ? fullmove - 1 : 0) * 2 + Number(fields[1] === 'b');
    return importedViewerTree(
      {
        initialFen: fen,
        ruleset: fields[2] === 'banqi' ? 'banqi-taiwan-2014-v1' : 'unrestricted-v1',
        annotations: { comments: [], shapes: [] },
        state: {
          fen,
          variant: fields[2] === 'banqi' ? 'banqi' : undefined,
          ply,
          turn: fields[1] === 'b' ? 'black' : 'red',
          legalMoves: [],
          check: false,
          gameResult: '*',
        },
        children: [],
      },
      source,
    );
  }
  const notation = source.pgn ?? source.moves?.join(' ') ?? '*';
  if (notation.length > 500000) throw new Error('Notation is too large');
  return importedViewerTree(
    await importXiangqiNotation(notation || '*', source.initialFen || XIANGQI_START_FEN, signal),
    source,
  );
}

export function lastNode(node: ViewerNode): ViewerNode {
  while (node.children[0]) node = node.children[0];
  return node;
}
