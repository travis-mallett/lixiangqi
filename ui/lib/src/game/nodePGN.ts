import type { TreeNode } from '@/tree/types';

import { fixCrazySan } from './chess';
import { notationComments, notationMarks } from './xiangqiNotation';

export const plyPrefix = (node: TreeNode): string =>
  `${Math.floor((node.ply + 1) / 2)}${node.ply % 2 === 1 ? '. ' : '... '}`;

export function renderNodesTxt(node: TreeNode, forcePly: boolean, annotations = false): string {
  if (node.children.length === 0) return '';

  let s = '';
  const first = node.children[0];
  if (forcePly || first.ply % 2 === 1) s += plyPrefix(first);
  s += fixCrazySan(first.san!);
  if (annotations) s += nodeAnnotations(first);

  for (let i = 1; i < node.children.length; i++) {
    const child = node.children[i];
    s += ` (${plyPrefix(child)}${fixCrazySan(child.san!)}`;
    if (annotations) s += nodeAnnotations(child);
    const variation = renderNodesTxt(child, false, annotations);
    if (variation) s += ' ' + variation;
    s += ')';
  }

  const mainline = renderNodesTxt(first, node.children.length > 1, annotations);
  if (mainline) s += ' ' + mainline;

  return s;
}

export function nodeAnnotations(node: TreeNode): string {
  const glyphs = (node.glyphs ?? []).map(glyph => `$${glyph.id}`).join(' ');
  const marks = notationMarks(
    node.shapes?.map(shape => ({
      from: shape.orig.replace(':', '10'),
      to: shape.dest?.replace(':', '10'),
      brush: shape.brush,
    })),
  );
  return (
    (glyphs ? ` ${glyphs}` : '') +
    notationComments([...(node.comments?.map(comment => comment.text) ?? []), ...(marks ? [marks] : [])])
  );
}
