import { jieqiOutcomeSuffix } from '../game/jieqi';
import { assertRecordedMovePosition } from '../game/recordedMove';
import { notationComments, notationMarks } from '../game/xiangqiNotation';
import { mainlineChild } from './ops';
import type { TreeNode } from './types';

export const plyPrefix = (node: TreeNode): string =>
  `${Math.floor((node.ply + 1) / 2)}${node.ply % 2 === 1 ? '. ' : '... '}`;

const revealedNotation = (node: TreeNode, parent: TreeNode): string => {
  let notation = node.notation;
  // Historical front/rear pawn labels can refer to more than one file. The browser
  // has recorded coordinates, but no rules formatter: use the existing lossless token.
  if (/^[+-]p/i.test(notation ?? '')) {
    if (
      !node.uci ||
      node.id !== node.uci + jieqiOutcomeSuffix(node.state) ||
      parent.fen !== parent.state.fen ||
      parent.ply !== parent.state.ply ||
      node.fen !== node.state.fen ||
      node.ply !== node.state.ply
    )
      throw new Error('Invalid recorded move identity for notation export');
    assertRecordedMovePosition(parent.state, node.uci, node.state);
    notation = node.uci;
  }
  return notation + jieqiOutcomeSuffix(node.state);
};

const nodeResultAnnotation = (node: TreeNode): string => (node.result ? `[%nodeResult ${node.result}]` : '');

export function renderNodesTxt(node: TreeNode, forcePly: boolean, annotations = false): string {
  const annotate = (child: TreeNode): string =>
    annotations ? nodeAnnotations(child) : notationComments([nodeResultAnnotation(child)].filter(Boolean));
  const renderBranch = (child: TreeNode, force: boolean): string => {
    if (!child.notation) throw new Error('Move is missing its native notation');
    return `${force || child.ply % 2 ? plyPrefix(child) : ''}${revealedNotation(child, node)}${annotate(child)}${child.children.length ? ' ' + renderNodesTxt(child, false, annotations) : ''}`;
  };
  // PGN requires a first move to anchor variations. Native annotations preserve
  // forced status and node results independently of this structural backbone.
  const [first, ...variations] = node.children;
  if (!first) return '';
  const prefix = `${forcePly || first.ply % 2 ? plyPrefix(first) : ''}${revealedNotation(first, node)}${annotate(first)}`;
  const branches = variations.map(child => `(${renderBranch(child, true)})`);
  const continuation = renderNodesTxt(first, variations.length > 0, annotations);
  return [prefix, ...branches, continuation].filter(Boolean).join(' ');
}

export function renderTreeNotation(root: TreeNode): string {
  if (!root.ruleset) throw new Error('Tree is missing its native ruleset');
  // The import boundary normalizes tag names to lowercase. Normalize saved
  // metadata too before adding authoritative fields, so each tag appears once.
  const tags: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(root.metadata ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    ),
    variant:
      root.state.variant === 'jieqi'
        ? 'Jieqi'
        : root.state.variant === 'minixiangqi'
          ? 'Mini Xiangqi'
          : 'Xiangqi',
    fen: root.fen,
    setup: '1',
    ruleset: root.ruleset,
  };
  const headerNames: Record<string, string> = {
    red: 'Red',
    black: 'Black',
    white: 'White',
    result: 'Result',
    variant: 'Variant',
    fen: 'FEN',
    setup: 'SetUp',
    ruleset: 'Ruleset',
    event: 'Event',
    site: 'Site',
    date: 'Date',
    round: 'Round',
    annotator: 'Annotator',
    gameid: 'GameId',
  };
  const escape = (value: string): string =>
    value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r');
  const headers = Object.entries(tags)
    .map(([key, value]) => `[${headerNames[key] ?? key} "${escape(value)}"]`)
    .join('\n');
  const moves = renderNodesTxt(root, true, true);
  let last = root;
  while (mainlineChild(last)) last = mainlineChild(last)!;
  const result = tags.result ?? root.result ?? last.state.gameResult;
  return `${headers}\n\n${nodeAnnotations(root, false)}${moves} ${result}`.trim();
}

export function nodeAnnotations(node: TreeNode, includeNodeResult = true): string {
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
    includeNodeResult ? nodeResultAnnotation(node) : '',
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
