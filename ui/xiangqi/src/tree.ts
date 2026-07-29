export interface RulesState {
  variant?: string;
  fen: string;
  ply: number;
  turn: 'red' | 'black';
  legalMoves: string[];
  check: boolean;
  capture?: boolean;
  checkmate?: boolean;
  insufficientMaterial?: boolean;
  gameResult: string;
  immediateEnd?: { ended: boolean; result: number };
  optionalEnd?: { ended: boolean; result: number };
  needsHydration?: boolean;
}

export interface EngineScore {
  cp?: number;
  mate?: number;
  redCp?: number;
  redMate?: number;
  bound?: 'lower' | 'upper';
}

export interface NodeEvaluation {
  engine: string;
  depth: number;
  nodes: number;
  score: EngineScore;
  best?: string;
  variation?: string[];
}

export interface TreeComment {
  text: string;
  source?: string;
  author?: string;
  language?: string;
}

export interface ServerAnalysisInfo {
  ply: number;
  cp?: number;
  mate?: number;
  best?: string;
  variation: string[];
}

export interface XiangqiTreeNode {
  id: string;
  path: string;
  uci: string;
  notation: string;
  wxfNotation: string;
  chineseNotation?: string;
  state: RulesState;
  children: XiangqiTreeNode[];
  forceVariation?: boolean;
  collapsed?: boolean;
  evaluation?: NodeEvaluation;
  comments?: TreeComment[];
}

export interface XiangqiTreeRoot {
  id: 'root';
  path: '';
  state: RulesState;
  children: XiangqiTreeNode[];
  collapsed?: boolean;
  evaluation?: NodeEvaluation;
  comments?: TreeComment[];
}

export type XiangqiPositionNode = XiangqiTreeRoot | XiangqiTreeNode;

export interface XiangqiMoveTree {
  root: XiangqiTreeRoot;
  byPath: Map<string, XiangqiPositionNode>;
  nextId: number;
}

export interface ImportedTreeNode {
  move: string;
  notation: string;
  chineseNotation?: string;
  state: RulesState;
  children: ImportedTreeNode[];
}

export interface ImportedMoveTree {
  initialFen: string;
  state: RulesState;
  children: ImportedTreeNode[];
}

interface StoredTreeNode {
  id: string;
  uci: string;
  notation: string;
  wxfNotation?: string;
  chineseNotation?: string;
  state: RulesState;
  children: StoredTreeNode[];
  forceVariation?: boolean;
  collapsed?: boolean;
  evaluation?: NodeEvaluation;
  comments?: TreeComment[];
}

export interface StoredMoveTree {
  version: 1;
  variant: 'xiangqi';
  initialFen: string;
  nextId: number;
  root: {
    state: RulesState;
    children: StoredTreeNode[];
    collapsed?: boolean;
    evaluation?: NodeEvaluation;
    comments?: TreeComment[];
  };
  activePath: string;
  savedAt: string;
}

const ROOT_PATH = '';
const PATH_SEPARATOR = '.';
const MAX_STORED_NODES = 2_000;

export function createMoveTree(state: RulesState): XiangqiMoveTree {
  const root: XiangqiTreeRoot = { id: 'root', path: ROOT_PATH, state, children: [] };
  return { root, byPath: new Map([[ROOT_PATH, root]]), nextId: 1 };
}

export function createMoveTreeFromImport(imported: ImportedMoveTree, chinese = false): XiangqiMoveTree {
  const tree = createMoveTree(imported.state);

  const addChildren = (parent: XiangqiPositionNode, children: ImportedTreeNode[]): void => {
    for (const importedChild of children) {
      const child = createChild(tree, parent, {
        uci: importedChild.move,
        notation: chinese ? importedChild.chineseNotation || importedChild.notation : importedChild.notation,
        wxfNotation: importedChild.notation,
        chineseNotation: importedChild.chineseNotation,
        state: importedChild.state,
      });
      parent.children.push(child);
      addChildren(child, importedChild.children);
    }
  };

  addChildren(tree.root, imported.children);
  return tree;
}

export function createMoveTreeFromStates(
  states: RulesState[],
  moves: string[],
  notations: string[],
  chineseNotations: string[] = [],
  chinese = false,
  analysis: ServerAnalysisInfo[] = [],
): XiangqiMoveTree {
  if (states.length !== moves.length + 1 || moves.length !== notations.length)
    throw new Error('Native Xiangqi game data has inconsistent moves, notation, and positions');
  const tree = createMoveTree(states[0]);
  const analysisByPly = new Map(analysis.map(info => [info.ply, info]));
  let parent: XiangqiPositionNode = tree.root;
  moves.forEach((uci, index) => {
    const state = states[index + 1];
    const info = analysisByPly.get(state.ply);
    const child = createChild(tree, parent, {
      uci,
      notation: chinese ? chineseNotations[index] || notations[index] : notations[index],
      wxfNotation: notations[index],
      chineseNotation: chineseNotations[index],
      state,
    });
    if (info)
      child.evaluation = {
        engine: 'Pikafish server analysis',
        depth: 0,
        nodes: 0,
        score: {
          ...(info.cp === undefined ? {} : { redCp: info.cp }),
          ...(info.mate === undefined ? {} : { redMate: info.mate }),
        },
        ...(info.best ? { best: info.best } : {}),
        ...(info.variation.length ? { variation: info.variation } : {}),
      };
    parent.children.push(child);
    parent = child;
  });
  return tree;
}

export function createMoveTreeFromUciMainline(
  initialFen: string,
  moves: string[],
  notations: string[] = [],
): XiangqiMoveTree {
  let state = lightweightState(initialFen);
  const tree = createMoveTree(state);
  let parent: XiangqiPositionNode = tree.root;

  moves.forEach((move, index) => {
    const transition = applyUciMoveToFen(state.fen, move);
    state = { ...lightweightState(transition.fen), capture: transition.capture };
    const child = createChild(tree, parent, {
      uci: move,
      notation: notations[index] || move,
      wxfNotation: notations[index] || move,
      state,
    });
    parent.children.push(child);
    parent = child;
  });
  return tree;
}

function lightweightState(fen: string): RulesState {
  const fields = fen.split(/\s+/);
  const fullmove = Math.max(1, Number.parseInt(fields[5] || '1', 10) || 1);
  const blackToMove = fields[1] === 'b';
  return {
    variant: 'xiangqi',
    fen,
    ply: (fullmove - 1) * 2 + (blackToMove ? 1 : 0),
    turn: blackToMove ? 'black' : 'red',
    legalMoves: [],
    check: false,
    gameResult: '*',
    needsHydration: true,
  };
}

function applyUciMoveToFen(fen: string, move: string): { fen: string; capture: boolean } {
  const match = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.exec(move);
  const fields = fen.trim().split(/\s+/);
  if (!match || fields.length < 2 || !['w', 'b'].includes(fields[1]))
    throw new Error(`Cannot load malformed Xiangqi game move: ${move}`);

  const ranks = fields[0].split('/').map(rank => {
    const points: string[] = [];
    for (const token of rank) {
      const empty = Number.parseInt(token, 10);
      if (Number.isNaN(empty)) points.push(token);
      else points.push(...Array<string>(empty).fill(''));
    }
    if (points.length !== 9) throw new Error('Cannot load malformed Xiangqi game position');
    return points;
  });
  if (ranks.length !== 10) throw new Error('Cannot load malformed Xiangqi game position');

  const square = (file: string, rank: string): [number, number] => [
    10 - Number(rank),
    file.charCodeAt(0) - 97,
  ];
  const [fromRank, fromFile] = square(match[1], match[2]);
  const [toRank, toFile] = square(match[3], match[4]);
  const piece = ranks[fromRank]?.[fromFile];
  if (!piece) throw new Error(`Cannot load invalid Xiangqi game move: ${move}`);
  const capture = Boolean(ranks[toRank]?.[toFile]);
  ranks[fromRank][fromFile] = '';
  ranks[toRank][toFile] = piece;

  fields[0] = ranks
    .map(rank => {
      let encoded = '';
      let empty = 0;
      for (const point of rank) {
        if (!point) empty += 1;
        else {
          if (empty) encoded += empty;
          encoded += point;
          empty = 0;
        }
      }
      return encoded + (empty || '');
    })
    .join('/');
  const blackMoved = fields[1] === 'b';
  fields[1] = blackMoved ? 'w' : 'b';
  fields[4] = String((Number.parseInt(fields[4] || '0', 10) || 0) + 1);
  fields[5] = String((Number.parseInt(fields[5] || '1', 10) || 1) + (blackMoved ? 1 : 0));
  return { fen: fields.join(' '), capture };
}

export function nodeAtPath(tree: XiangqiMoveTree, path: string): XiangqiPositionNode | undefined {
  return tree.byPath.get(path);
}

export function parentPath(path: string): string {
  const separator = path.lastIndexOf(PATH_SEPARATOR);
  return separator < 0 ? ROOT_PATH : path.slice(0, separator);
}

export function getNodeList(tree: XiangqiMoveTree, path: string): XiangqiPositionNode[] {
  const nodes: XiangqiPositionNode[] = [tree.root];
  if (!path) return nodes;

  let current: XiangqiPositionNode = tree.root;
  for (const segment of path.split(PATH_SEPARATOR).filter(Boolean)) {
    const child: XiangqiTreeNode | undefined = current.children.find(candidate => candidate.id === segment);
    if (!child) break;
    nodes.push(child);
    current = child;
  }
  return nodes;
}

export function movesToPath(tree: XiangqiMoveTree, path: string): string[] {
  return getNodeList(tree, path)
    .slice(1)
    .map(node => (node as XiangqiTreeNode).uci);
}

export function addOrSelectChild(
  tree: XiangqiMoveTree,
  path: string,
  move: Pick<XiangqiTreeNode, 'uci' | 'notation' | 'state'> &
    Partial<Pick<XiangqiTreeNode, 'wxfNotation' | 'chineseNotation'>>,
): { path: string; created: boolean } {
  const parent = nodeAtPath(tree, path);
  if (!parent) return { path, created: false };

  const existing = parent.children.find(child => child.uci === move.uci);
  if (existing) return { path: existing.path, created: false };

  const child = createChild(tree, parent, move);
  parent.children.push(child);
  return { path: child.path, created: true };
}

function createChild(
  tree: XiangqiMoveTree,
  parent: XiangqiPositionNode,
  move: Pick<XiangqiTreeNode, 'uci' | 'notation' | 'state'> &
    Partial<Pick<XiangqiTreeNode, 'wxfNotation' | 'chineseNotation'>>,
  storedId?: string,
): XiangqiTreeNode {
  const id = storedId ?? nextNodeId(tree);
  const path = parent.path ? `${parent.path}${PATH_SEPARATOR}${id}` : id;
  const child: XiangqiTreeNode = {
    id,
    path,
    ...move,
    wxfNotation: move.wxfNotation ?? move.notation,
    children: [],
  };
  tree.byPath.set(path, child);
  return child;
}

function nextNodeId(tree: XiangqiMoveTree): string {
  const id = tree.nextId.toString(36).padStart(2, '0');
  tree.nextId += 1;
  return id;
}

export function mainlineEndPath(tree: XiangqiMoveTree): string {
  return extendPath(tree, ROOT_PATH, true);
}

export function currentLineEndPath(tree: XiangqiMoveTree, path: string): string {
  return extendPath(tree, path, pathIsMainline(tree, path) && !pathIsForcedVariation(tree, path));
}

export function extendPath(tree: XiangqiMoveTree, path: string, isMainline: boolean): string {
  let current = nodeAtPath(tree, path);
  while (current?.children[0] && !(isMainline && current.children[0].forceVariation)) {
    current = current.children[0];
    path = current.path;
  }
  return path;
}

export function pathIsMainline(tree: XiangqiMoveTree, path: string): boolean {
  const nodes = getNodeList(tree, path);
  return nodes.slice(1).every((node, index) => nodes[index].children[0] === node);
}

export function pathIsForcedVariation(tree: XiangqiMoveTree, path: string): boolean {
  return getNodeList(tree, path).some(node => isMoveNode(node) && node.forceVariation === true);
}

export function canPromote(tree: XiangqiMoveTree, path: string): boolean {
  const nodes = getNodeList(tree, path);
  return nodes.slice(1).some((node, index) => nodes[index].children[0] !== node);
}

export function promote(tree: XiangqiMoveTree, path: string, toMainline: boolean): void {
  const nodes = getNodeList(tree, path);
  for (let index = nodes.length - 2; index >= 0; index--) {
    const parent = nodes[index];
    const node = nodes[index + 1] as XiangqiTreeNode;
    if (parent.children[0] !== node) {
      parent.children = [node, ...parent.children.filter(child => child !== node)];
      if (!toMainline) break;
    } else if (node.forceVariation) {
      delete node.forceVariation;
      if (!toMainline) break;
    }
  }
}

export function forceVariation(tree: XiangqiMoveTree, path: string, force: boolean): void {
  tree.byPath.forEach(node => {
    if (node !== tree.root) delete (node as XiangqiTreeNode).forceVariation;
  });
  const node = nodeAtPath(tree, path);
  if (node && isMoveNode(node)) node.forceVariation = force || undefined;
}

export function deleteNode(tree: XiangqiMoveTree, path: string): string {
  if (!path) return ROOT_PATH;
  const node = nodeAtPath(tree, path);
  const parent = nodeAtPath(tree, parentPath(path));
  if (!node || node === tree.root || !parent) return path;

  const removeFromIndex = (current: XiangqiTreeNode): void => {
    current.children.forEach(removeFromIndex);
    tree.byPath.delete(current.path);
  };
  removeFromIndex(node as XiangqiTreeNode);
  parent.children = parent.children.filter(child => child !== node);
  return parent.path;
}

export function countNodes(node: XiangqiPositionNode): number {
  return node.children.reduce((total, child) => total + countNodes(child), 1);
}

export function siblingPath(tree: XiangqiMoveTree, path: string, direction: -1 | 1): string {
  if (!path) return path;
  const parent = nodeAtPath(tree, parentPath(path));
  if (!parent || parent.children.length < 2) return path;
  const segments = path.split(PATH_SEPARATOR);
  const branchId = segments[segments.length - 1];
  const index = parent.children.findIndex(child => child.id === branchId);
  if (index < 0) return path;
  return parent.children[(index + direction + parent.children.length) % parent.children.length].path;
}

export function serializeMoveTree(
  tree: XiangqiMoveTree,
  initialFen: string,
  activePath: string,
): StoredMoveTree {
  const storeNode = (node: XiangqiTreeNode): StoredTreeNode => ({
    id: node.id,
    uci: node.uci,
    notation: node.notation,
    wxfNotation: node.wxfNotation,
    ...(node.chineseNotation ? { chineseNotation: node.chineseNotation } : {}),
    state: node.state,
    children: node.children.map(storeNode),
    ...(node.forceVariation ? { forceVariation: true } : {}),
    ...(node.collapsed ? { collapsed: true } : {}),
    ...(node.evaluation ? { evaluation: node.evaluation } : {}),
    ...(node.comments?.length ? { comments: node.comments } : {}),
  });

  return {
    version: 1,
    variant: 'xiangqi',
    initialFen,
    nextId: tree.nextId,
    root: {
      state: tree.root.state,
      children: tree.root.children.map(storeNode),
      ...(tree.root.collapsed ? { collapsed: true } : {}),
      ...(tree.root.evaluation ? { evaluation: tree.root.evaluation } : {}),
      ...(tree.root.comments?.length ? { comments: tree.root.comments } : {}),
    },
    activePath: tree.byPath.has(activePath) ? activePath : ROOT_PATH,
    savedAt: new Date().toISOString(),
  };
}

export function deserializeMoveTree(
  value: unknown,
  expectedFen: string,
  chinese = false,
): {
  tree: XiangqiMoveTree;
  activePath: string;
} {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.variant !== 'xiangqi' ||
    value.initialFen !== expectedFen
  )
    throw new Error('Saved Xiangqi analysis has an incompatible format');
  if (!isRecord(value.root) || !isRulesState(value.root.state) || !Array.isArray(value.root.children))
    throw new Error('Saved Xiangqi analysis is missing its root position');

  const tree = createMoveTree(value.root.state);
  tree.root.collapsed = value.root.collapsed === true || undefined;
  tree.root.evaluation = isNodeEvaluation(value.root.evaluation) ? value.root.evaluation : undefined;
  tree.root.comments = isTreeComments(value.root.comments) ? value.root.comments : undefined;
  let nodeCount = 0;
  let nextIdFromNodes = 1;

  const restore = (parent: XiangqiPositionNode, stored: unknown): XiangqiTreeNode => {
    nodeCount += 1;
    if (nodeCount > MAX_STORED_NODES) throw new Error('Saved Xiangqi analysis is too large');
    if (
      !isRecord(stored) ||
      typeof stored.id !== 'string' ||
      !/^[0-9a-z]{2,6}$/.test(stored.id) ||
      typeof stored.uci !== 'string' ||
      typeof stored.notation !== 'string' ||
      !isRulesState(stored.state) ||
      !Array.isArray(stored.children)
    )
      throw new Error('Saved Xiangqi analysis contains an invalid move');

    const wxfNotation = typeof stored.wxfNotation === 'string' ? stored.wxfNotation : stored.notation;
    const chineseNotation = typeof stored.chineseNotation === 'string' ? stored.chineseNotation : undefined;
    const child = createChild(
      tree,
      parent,
      {
        uci: stored.uci,
        notation: chinese ? chineseNotation || wxfNotation : wxfNotation,
        wxfNotation,
        chineseNotation,
        state: stored.state,
      },
      stored.id,
    );
    nextIdFromNodes = Math.max(nextIdFromNodes, Number.parseInt(stored.id, 36) + 1);
    if (parent.children.some(sibling => sibling.id === child.id || sibling.uci === child.uci))
      throw new Error('Saved Xiangqi analysis contains a duplicate branch');
    child.forceVariation = stored.forceVariation === true || undefined;
    child.collapsed = stored.collapsed === true || undefined;
    child.evaluation = isNodeEvaluation(stored.evaluation) ? stored.evaluation : undefined;
    child.comments = isTreeComments(stored.comments) ? stored.comments : undefined;
    parent.children.push(child);
    stored.children.forEach(grandchild => restore(child, grandchild));
    return child;
  };

  value.root.children.forEach(child => restore(tree.root, child));
  const storedNextId =
    typeof value.nextId === 'number' && Number.isSafeInteger(value.nextId) && value.nextId > 0
      ? value.nextId
      : 1;
  tree.nextId = Math.max(storedNextId, nextIdFromNodes);
  const activePath =
    typeof value.activePath === 'string' && tree.byPath.has(value.activePath) ? value.activePath : '';
  return { tree, activePath };
}

export function analysisStorageKey(initialFen: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < initialFen.length; index++) {
    hash ^= initialFen.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `lixiangqi.analysis.v1.${(hash >>> 0).toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMoveNode(node: XiangqiPositionNode): node is XiangqiTreeNode {
  return node.path !== ROOT_PATH;
}

function isRulesState(value: unknown): value is RulesState {
  return (
    isRecord(value) &&
    typeof value.fen === 'string' &&
    typeof value.ply === 'number' &&
    (value.turn === 'red' || value.turn === 'black') &&
    Array.isArray(value.legalMoves) &&
    value.legalMoves.every((move: unknown) => typeof move === 'string') &&
    typeof value.check === 'boolean' &&
    typeof value.gameResult === 'string'
  );
}

function isNodeEvaluation(value: unknown): value is NodeEvaluation {
  return (
    isRecord(value) &&
    typeof value.engine === 'string' &&
    typeof value.depth === 'number' &&
    typeof value.nodes === 'number' &&
    isRecord(value.score)
  );
}

function isTreeComments(value: unknown): value is TreeComment[] {
  return (
    Array.isArray(value) &&
    value.every(
      comment =>
        isRecord(comment) &&
        typeof comment.text === 'string' &&
        (comment.source === undefined || typeof comment.source === 'string') &&
        (comment.author === undefined || typeof comment.author === 'string') &&
        (comment.language === undefined || typeof comment.language === 'string'),
    )
  );
}
