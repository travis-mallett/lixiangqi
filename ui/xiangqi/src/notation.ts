import { nodeAnnotations, renderNodesTxt, renderTreeNotation } from 'lib/tree/notation';
import type { TreeWrapper } from 'lib/tree/tree';

export const renderXiangqiMovetext = (tree: TreeWrapper): string =>
  nodeAnnotations(tree.root) + renderNodesTxt(tree.root, true, true);
export function renderXiangqiNotation(tree: TreeWrapper, initialFen: string): string {
  if (initialFen !== tree.root.fen) throw new Error('Notation root differs from analysis root');
  return renderTreeNotation(tree.root);
}
