import { h } from 'snabbdom';

import { renderTreeNotation } from 'lib/tree/notation';
import type { TreeNode } from 'lib/tree/types';
import { type MaybeVNodes } from 'lib/view';

import type AnalyseCtrl from './ctrl';

interface NotationNode {
  ply: Ply;
  notation?: string;
}

export function renderFullTxt(ctrl: AnalyseCtrl): string {
  const chapter = ctrl.study?.data.chapter;
  if (!chapter) return renderTreeNotation(ctrl.tree.root);
  const metadata = {
    ...Object.fromEntries(chapter.tags),
    ChapterName: chapter.name,
    Orientation: chapter.setup.orientation,
    ChapterMode: chapter.gamebook
      ? 'gamebook'
      : chapter.practice
        ? 'practice'
        : chapter.conceal !== undefined
          ? 'conceal'
          : 'normal',
    ...(chapter.conceal === undefined ? {} : { ConcealPly: String(chapter.conceal) }),
    ...(chapter.description === undefined ? {} : { ChapterDescription: chapter.description }),
  };
  return renderTreeNotation({ ...ctrl.tree.root, metadata });
}

export function renderNodesHtml(nodes: NotationNode[]): MaybeVNodes {
  if (!nodes[0]) return [];
  if (!nodes[0].notation) nodes = nodes.slice(1);
  if (!nodes[0]) return [];
  const tags: MaybeVNodes = [];
  if (nodes[0].ply % 2 === 0) tags.push(h('index', Math.floor((nodes[0].ply + 1) / 2) + '...'));
  nodes.forEach(node => {
    if (node.ply === 0) return;
    if (node.ply % 2 === 1) tags.push(h('index', (node.ply + 1) / 2 + '.'));
    tags.push(h('move-text', node.notation));
  });
  return tags;
}

export function renderVariationNotation(nodes: TreeNode[]): string {
  if (!nodes.length) return '';
  let children: TreeNode[] = [];
  for (let i = nodes.length - 1; i >= 0; i--) children = [{ ...nodes[i], forceVariation: false, children }];
  const root = children[0];
  const last = nodes[nodes.length - 1];
  root.metadata = { ...root.metadata, Result: last.result ?? last.state.gameResult };
  return renderTreeNotation(root);
}
