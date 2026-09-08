import type { VNode, Hooks } from 'snabbdom';

import { plyToTurn } from '@/game/chess';
import { type LooseVNodes, hl } from '@/view';

export interface ColumnTreeNode<N extends ColumnTreeNode<N>> {
  id: string;
  ply: number;
  children: N[];
}

export interface ColumnTreeMoveContext {
  path: string;
  isMainline: boolean;
  withIndex: boolean;
}

export interface ColumnTreeOptions<N extends ColumnTreeNode<N>> {
  root: N;
  renderMove: (node: N, context: ColumnTreeMoveContext) => VNode;
  hooks?: Hooks;
}

export function renderIndex(ply: number, withDots: boolean): VNode {
  return hl('index', plyToTurn(ply) + (withDots ? (ply % 2 === 1 ? '.' : '...') : ''));
}

function renderChildrenOf<N extends ColumnTreeNode<N>>(
  opts: ColumnTreeOptions<N>,
  node: N,
  parentPath: string,
  isMainline: boolean,
): LooseVNodes {
  const [main, ...variations] = node.children;
  if (!main) return [];

  if (isMainline) {
    const isWhite = main.ply % 2 === 1;
    if (!variations.length)
      return [
        isWhite && renderIndex(main.ply, false),
        renderMoveAndChildrenOf(opts, main, parentPath, true, false),
      ];

    const mainChildren = renderChildrenOf(opts, main, `${parentPath}${main.id}`, true);
    return [
      isWhite && renderIndex(main.ply, false),
      opts.renderMove(main, { path: `${parentPath}${main.id}`, isMainline: true, withIndex: false }),
      isWhite && emptyMove(),
      hl('interrupt', renderLines(opts, variations, parentPath)),
      isWhite && mainChildren && [renderIndex(main.ply, false), emptyMove()],
      mainChildren,
    ];
  }

  return variations.length
    ? [renderLines(opts, node.children, parentPath)]
    : renderMoveAndChildrenOf(opts, main, parentPath, false, main.ply % 2 === 1);
}

function renderLines<N extends ColumnTreeNode<N>>(
  opts: ColumnTreeOptions<N>,
  nodes: N[],
  parentPath: string,
): VNode {
  return hl(
    'lines',
    { class: { single: !!nodes[1] } },
    nodes.map(node => hl('line', renderMoveAndChildrenOf(opts, node, parentPath, false, true))),
  );
}

function renderMoveAndChildrenOf<N extends ColumnTreeNode<N>>(
  opts: ColumnTreeOptions<N>,
  node: N,
  parentPath: string,
  isMainline: boolean,
  withIndex: boolean,
): LooseVNodes {
  const path = `${parentPath}${node.id}`;
  return [
    opts.renderMove(node, { path, isMainline, withIndex }),
    renderChildrenOf(opts, node, path, isMainline),
  ];
}

function emptyMove(): VNode {
  return hl('move.empty', '...');
}

export function renderColumnTree<N extends ColumnTreeNode<N>>(opts: ColumnTreeOptions<N>): VNode {
  const root = opts.root;
  return hl('div.tview2.tview2-column', { hook: opts.hooks }, [
    root.ply % 2 === 1 && [renderIndex(root.ply, false), emptyMove()],
    renderChildrenOf(opts, root, '', true),
  ]);
}
