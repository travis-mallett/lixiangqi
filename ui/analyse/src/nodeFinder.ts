import { winningChances } from 'lib/ceval';
import type { XiangqiSide as Color } from 'lib/game/xiangqi';
import type { TreeNode } from 'lib/tree/types';

const hasCompChild = (node: TreeNode): boolean => node.children.some(c => !!c.comp);

export const nextGlyphSymbol = (
  color: Color,
  symbol: string,
  mainline: TreeNode[],
  fromPly: Ply,
): TreeNode | undefined =>
  mainline
    .map((_, i) => mainline[(fromPly - mainline[0].ply + i + 1) % mainline.length])
    .find(n => n.ply % 2 === (color === 'red' ? 1 : 0) && n.glyphs?.some(g => g.symbol === symbol));

export const evalSwings = (mainline: TreeNode[], nodeFilter: (node: TreeNode) => boolean): TreeNode[] =>
  mainline.slice(1).filter((curr, i) => {
    const prev = mainline[i];
    return (
      nodeFilter(curr) &&
      curr.eval &&
      prev.eval &&
      hasCompChild(prev) &&
      (Math.abs(winningChances.povDiff('red', prev.eval, curr.eval)) > 0.1 ||
        (prev.eval.mate && !curr.eval.mate && Math.abs(prev.eval.mate) <= 3))
    );
  });
