import { mainlineChild } from 'lib/tree/ops';
import type { TreeNodeBase } from 'lib/tree/types';

export type SourceGameLine = readonly Pick<TreeNodeBase, 'fen' | 'ply' | 'uci'>[];

export function hasStoredEvaluations(nodes: readonly TreeNodeBase[]): boolean {
  return nodes.slice(1).some(node => node.eval?.cp !== undefined || node.eval?.mate !== undefined);
}

export function snapshotSourceGame(nodes: readonly TreeNodeBase[]): SourceGameLine {
  return nodes.map(({ fen, ply, uci }) => ({ fen, ply, uci }));
}

// Source scores are a response-only overlay. Keep chapter annotations and client
// evaluations when discarding it, including annotations on the former mainline.
export function clearSourceGameEvals(root: TreeNodeBase): void {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if ((node.eval as { sourceGame?: boolean } | undefined)?.sourceGame) delete node.eval;
    if (node.children) pending.push(...node.children);
  }
}

export function matchesSourceGame(root: TreeNodeBase, original: SourceGameLine): boolean {
  if (root.fen !== original[0]?.fen) return false;
  let node: TreeNodeBase | undefined = root;
  let index = 0;
  while (node) {
    const expected = original[index++];
    if (!expected || node.ply !== expected.ply || node.uci !== expected.uci) return false;
    node = mainlineChild(node);
  }
  return index === original.length;
}
