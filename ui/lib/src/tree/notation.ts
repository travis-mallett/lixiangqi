import { notationComments, notationMarks } from '../game/xiangqiNotation';
import { mainlineFirst, mainlineChild } from './ops';
import type { TreeNode } from './types';

export const plyPrefix = (node: TreeNode): string =>
  `${Math.floor((node.ply + 1) / 2)}${node.ply % 2 === 1 ? '. ' : '... '}`;

export function renderNodesTxt(
  node: TreeNode,
  forcePly: boolean,
  annotations = false,
  mainline = true,
): string {
  const renderBranch = (child: TreeNode, force: boolean, main: boolean): string => {
    if (!child.notation) throw new Error('Move is missing its native notation');
    return `${force || child.ply % 2 ? plyPrefix(child) : ''}${child.notation}${annotations ? nodeAnnotations(child) : ''}${child.children.length ? ' ' + renderNodesTxt(child, false, annotations, main) : ''}${child.result ? ' ' + child.result : ''}`;
  };
  const [first, ...variations] = mainline ? mainlineFirst(node.children) : node.children;
  if (!first) return '';
  if (mainline && first.forceVariation)
    return node.children.map(child => `(${renderBranch(child, true, false)})`).join(' ');
  const prefix = `${forcePly || first.ply % 2 ? plyPrefix(first) : ''}${first.notation}${annotations ? nodeAnnotations(first) : ''}`;
  const branches = variations.map(child => `(${renderBranch(child, true, false)})`);
  const continuation = renderNodesTxt(first, variations.length > 0, annotations, mainline);
  return [prefix, ...branches, continuation, first.result ?? ''].filter(Boolean).join(' ');
}

export function renderTreeNotation(root: TreeNode): string {
  if (!root.ruleset) throw new Error('Tree is missing its native ruleset');
  const tags = { ...root.metadata, Variant: 'Xiangqi', FEN: root.fen, SetUp: '1', Ruleset: root.ruleset };
  const escape = (value: string): string =>
    value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
  const headers = Object.entries(tags)
    .map(([key, value]) => `[${key} "${escape(value)}"]`)
    .join('\n');
  const moves = renderNodesTxt(root, true, true);
  let last = root;
  while (mainlineChild(last)) last = mainlineChild(last)!;
  const result = last.result ? '' : (root.metadata?.Result ?? last.state.gameResult);
  return `${headers}\n\n${nodeAnnotations(root)}${moves}${result ? ' ' + result : ''}`.trim();
}

export function nodeAnnotations(node: TreeNode): string {
  const glyphs = (node.glyphs ?? []).map(glyph => `$${glyph.id}`).join(' ');
  const marks = notationMarks(
    node.shapes?.map(shape => ({
      from: shape.orig,
      to: shape.dest,
      brush: shape.brush,
    })),
  );
  const time = (centis: number): string =>
    `${Math.floor(centis / 360000)}:${String(Math.floor(centis / 6000) % 60).padStart(2, '0')}:${((centis % 6000) / 100).toFixed(2).padStart(5, '0')}`;
  const evaluation = node.evaluation ?? node.eval;
  const study = {
    forceVariation: node.forceVariation || undefined,
    gamebook: node.gamebook,
    computer: node.comp || undefined,
    clockTrust: node.clockTrust,
  };
  const structured = [
    Object.values(study).some(value => value !== undefined) ? `[%study ${JSON.stringify(study)}]` : '',
    marks,
    node.clock === undefined ? '' : `[%clk ${time(node.clock)}]`,
    node.elapsed === undefined ? '' : `[%emt ${time(node.elapsed)}]`,
    evaluation && (evaluation.cp !== undefined || evaluation.mate !== undefined)
      ? `[%eval ${evaluation.mate !== undefined ? '#' + evaluation.mate : (evaluation.cp! / 100).toFixed(2)}${evaluation.depth === undefined ? '' : ',' + evaluation.depth}]`
      : '',
  ].filter(Boolean);
  return (
    (glyphs ? ` ${glyphs}` : '') +
    notationComments([
      ...(node.comments?.map(({ id, by, text }) => `[%comment ${JSON.stringify({ id, by, text })}]`) ?? []),
      ...structured,
    ])
  );
}
