import type {
  ImportedMoveTree,
  ImportedTreeNode,
  NotationAnnotations,
  RulesState,
} from '../game/xiangqiNotation';
import { completeNode } from './node';
import { countChildrenAndComments, structuredCloneLite } from './ops';
import * as pathOps from './path';
import { makeTree, type TreeWrapper } from './tree';
import type { Glyph, TreeNode, TreeNodeBase, TreeNodeLite } from './types';

export type { ImportedMoveTree, ImportedTreeNode, RulesState } from '../game/xiangqiNotation';
export type { EngineScore } from '../ceval/engines/pikafishProtocol';
export type XiangqiMoveTree = TreeWrapper;
export type XiangqiPositionNode = TreeNode;
export type XiangqiTreeNode = TreeNode;

export interface ServerAnalysisInfo {
  ply: number;
  cp?: number;
  mate?: number;
  best?: string;
  variation: string[];
}

export const annotationGlyph = (id: number): Glyph => ({
  id,
  name: `$${id}`,
  symbol: ({ 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' } as Record<number, string>)[id] ?? `$${id}`,
});

export function createMoveTree(state: RulesState, ruleset = 'unrestricted-v1'): TreeWrapper {
  return makeTree(completeNode({ fen: state.fen, ply: state.ply, state, ruleset, children: [] }));
}

/** Imported notation and live study JSON become the same canonical tree. */
export function importedTree(imported: ImportedMoveTree): TreeNode {
  let commentId = 0;
  const build = (
    state: RulesState,
    children: ImportedTreeNode[],
    annotations: NotationAnnotations,
    move?: ImportedTreeNode,
  ): TreeNodeBase => ({
    id: move?.move ?? '',
    uci: move?.move,
    notation: move?.notation,
    chineseNotation: move?.chineseNotation,
    fen: state.fen,
    ply: state.ply,
    state,
    comments: annotations.comments.map(comment => ({
      id: comment.id ?? `import-${commentId++}`,
      by:
        comment.by ??
        (imported.headers?.Annotator
          ? { kind: 'external', name: imported.headers.Annotator }
          : { kind: 'unknown' }),
      text: comment.text,
    })),
    shapes: annotations.shapes,
    clock: annotations.clock,
    elapsed: annotations.elapsed,
    evaluation: annotations.evaluation,
    forceVariation: annotations.study?.forceVariation,
    gamebook: annotations.study?.gamebook,
    comp: annotations.study?.computer,
    clockTrust: annotations.study?.clockTrust,
    glyphs: move?.glyphs?.map(annotationGlyph),
    result: move?.result,
    children: children.map(child => build(child.state, child.children, child.annotations, child)),
  });
  return completeNode({
    ...build(imported.state, imported.children, imported.annotations),
    ruleset: imported.ruleset,
    metadata: imported.headers,
    glyphs: imported.glyphs?.map(annotationGlyph),
  });
}

export const createMoveTreeFromImport = (imported: ImportedMoveTree): TreeWrapper =>
  makeTree(importedTree(imported));

export function createMoveTreeFromStates(
  states: RulesState[],
  moves: string[],
  notations: string[],
  chineseNotations: string[] = [],
  analysis: ServerAnalysisInfo[] = [],
  analysisDepth = 0,
  ruleset = 'unrestricted-v1',
): TreeWrapper {
  if (states.length !== moves.length + 1 || moves.length !== notations.length)
    throw new Error('Native Xiangqi game data has inconsistent moves, notation, and positions');
  const tree = createMoveTree(states[0], ruleset);
  let path = '';
  moves.forEach((uci, index) => {
    path = addOrSelectChild(tree, path, {
      uci,
      notation: notations[index],
      chineseNotation: chineseNotations[index],
      state: states[index + 1],
    }).path;
  });
  applyServerAnalysis(tree, analysis, analysisDepth);
  return tree;
}

export function applyServerAnalysis(
  tree: TreeWrapper,
  infos: ServerAnalysisInfo[],
  depth = 0,
  positions: TreeNode[] = tree.getNodeList(mainlineEndPath(tree)),
): void {
  const byPly = new Map(infos.map(info => [info.ply, info]));
  for (const node of positions) {
    if (!tree.pathExists(node.path) || tree.nodeAtPath(node.path) !== node) continue;
    const info = byPly.get(node.ply);
    if (!info || (info.cp === undefined && info.mate === undefined)) continue;
    node.evaluation = {
      cp: info.cp,
      mate: info.mate,
      depth,
      best: info.best,
      variation: info.variation,
      engine: 'Pikafish',
      nodes: 0,
    };
  }
}

export function recordedPositions(tree: TreeWrapper, initialFen: string, moves: string[]): TreeNode[] {
  if (tree.root.fen !== initialFen) return [];
  const path = pathOps.join(moves);
  return tree.getNodeList(tree.longestValidPath(path));
}

export const nodeAtPath = (tree: TreeWrapper, path: string): TreeNode | undefined =>
  tree.pathExists(path) ? tree.nodeAtPath(path) : undefined;
export const parentPath: typeof pathOps.init = pathOps.init;
export const getNodeList = (tree: TreeWrapper, path: string): TreeNode[] => tree.getNodeList(path);
export const movesToPath = (tree: TreeWrapper, path: string): string[] => tree.positionAt(path).moves;

export function addOrSelectChild(
  tree: TreeWrapper,
  path: string,
  move: { uci: string; notation: string; chineseNotation?: string; state: RulesState },
): { path: string; created: boolean } {
  const target = pathOps.append(path, move.uci);
  if (tree.pathExists(target)) return { path: target, created: false };
  const added = tree.addNode(
    completeNode({ ...move, fen: move.state.fen, ply: move.state.ply, children: [] }),
    path,
  );
  if (!added) throw new Error(`Unknown tree parent: ${path}`);
  return { path: added, created: true };
}

export const mainlineEndPath = (tree: TreeWrapper): string => tree.extendPath('', true);
export const currentLineEndPath = (tree: TreeWrapper, path: string): string =>
  tree.extendPath(path, tree.pathIsMainline(path) && !tree.pathIsForcedVariation(path));
export const extendPath = (tree: TreeWrapper, path: string, mainline: boolean): string =>
  tree.extendPath(path, mainline);
export const pathIsMainline = (tree: TreeWrapper, path: string): boolean => tree.pathIsMainline(path);
export const pathIsForcedVariation = (tree: TreeWrapper, path: string): boolean =>
  tree.pathIsForcedVariation(path);
export const canPromote = (tree: TreeWrapper, path: string): boolean =>
  !tree.pathIsMainline(path) || tree.pathIsForcedVariation(path);
export const promote = (tree: TreeWrapper, path: string, mainline: boolean): void =>
  tree.promoteAt(path, mainline);
export const forceVariation = (tree: TreeWrapper, path: string, force: boolean): void => {
  tree.forceVariationAt(path, force);
};
export const countNodes = (node: TreeNode): number => countChildrenAndComments(node).nodes;

export function deleteNode(tree: TreeWrapper, path: string): string {
  if (!path) return '';
  tree.deleteNodeAt(path);
  return pathOps.init(path);
}

export function siblingPath(tree: TreeWrapper, path: string, direction: -1 | 1): string {
  if (!path) return path;
  const parent = tree.parentNode(path);
  const index = parent.children.findIndex(node => node.id === pathOps.last(path));
  return parent.children[(index + direction + parent.children.length) % parent.children.length].path;
}

export interface StoredMoveTree {
  version: 2;
  initialFen: string;
  root: TreeNodeLite;
  activePath: string;
  savedAt: string;
}

export function serializeMoveTree(tree: TreeWrapper, initialFen: string, activePath: string): StoredMoveTree {
  if (tree.root.fen !== initialFen || !tree.pathExists(activePath))
    throw new Error('Invalid analysis position');
  return {
    version: 2,
    initialFen,
    root: structuredCloneLite(tree.root),
    activePath,
    savedAt: new Date().toISOString(),
  };
}

export function deserializeMoveTree(
  value: unknown,
  expectedFen: string,
): { tree: TreeWrapper; activePath: string } {
  const stored = value as StoredMoveTree;
  if (
    stored?.version !== 2 ||
    stored.initialFen !== expectedFen ||
    stored.root?.fen !== expectedFen ||
    !stored.root.ruleset
  )
    throw new Error('Saved Xiangqi analysis has an incompatible format');
  if (countChildrenAndComments(stored.root).nodes > 2000)
    throw new Error('Saved Xiangqi analysis is too large');
  const tree = makeTree(completeNode(stored.root));
  if (!tree.pathExists(stored.activePath))
    throw new Error('Saved Xiangqi analysis has an invalid active path');
  return { tree, activePath: stored.activePath };
}

export function analysisStorageKey(initialFen: string): string {
  let hash = 0x811c9dc5;
  for (const character of initialFen) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  return `lixiangqi.analysis.v2.${(hash >>> 0).toString(36)}`;
}
