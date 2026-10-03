import type { RulesState, CommentAuthor } from '../game/xiangqiNotation';

export interface Outcome {
  winner?: 'red' | 'black';
}

export type TreeNodeId = string;
export type TreePath = string;

interface ClientEvalBase extends EvalScore {
  bestmove?: Uci;
  ponder?: Uci;
  fen: FEN;
  depth: number;
  nodes: number;
  pvs: PvData[];
}
export interface CloudEval extends ClientEvalBase {
  cloud: true;
  millis?: undefined;
}
export interface LocalEval extends ClientEvalBase {
  cloud?: false;
  millis: number;
}
export type ClientEval = CloudEval | LocalEval;

export interface ServerEval extends EvalScore {
  best?: Uci | '(none)';
  fen: FEN;
  knodes: number;
  depth: number;
  pvs: PvDataServer[];
}

export interface PvDataServer extends EvalScore {
  moves: string;
}

export interface PvData extends EvalScore {
  moves: string[];
}

export interface TreeNodeBase {
  // file://./../../tree/src/tree.ts
  id?: TreeNodeId;
  children?: TreeNodeBase[];
  ply: Ply;
  uci?: Uci;
  fen: FEN;
  comments?: TreeComment[];
  gamebook?: Gamebook;
  threat?: LocalEval;
  ceval?: ClientEval;
  eval?: ServerEval;
  glyphs?: Glyph[];
  clock?: Clock;
  elapsed?: Clock;
  evaluation?: {
    cp?: number;
    mate?: number;
    depth?: number;
    engine?: string;
    nodes?: number;
    best?: string;
    variation?: string[];
  };
  parentClock?: Clock;
  clockTrust?: boolean;
  forceVariation?: boolean;
  shapes?: Shape[];
  comp?: boolean;
  notation?: string;
  chineseNotation?: string;
  state: RulesState;
  ruleset?: string;
  result?: string;
  metadata?: Record<string, string>;
  fail?: boolean;
  puzzle?: 'win' | 'fail' | 'good' | 'retry';
  collapsed?: boolean;
  dests?: () => ReadonlyMap<string, readonly string[]>;
  check?: () => boolean;
  outcome?: () => Outcome | undefined;
}

type TreeNodeFunctionProps<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends (...args: any) => any ? K : never;
}[keyof T];

export interface TreeNodeLite extends Omit<TreeNodeBase, TreeNodeFunctionProps<TreeNodeBase>> {
  id: TreeNodeId;
  children: TreeNodeLite[];
}

export interface TreeNode extends TreeNodeLite {
  path: TreePath;
  children: TreeNode[];
  dests: () => ReadonlyMap<string, readonly string[]>;
  check: () => boolean;
  outcome: () => Outcome | undefined;
}

export interface TreeComment {
  id: string;
  by: CommentAuthor;
  text: string;
  source?: string;
  author?: string;
  language?: string;
}

export interface Gamebook {
  deviation?: string;
  hint?: string;
  shapes?: Shape[];
}

export type GlyphId = number;

export interface Glyph {
  id: GlyphId;
  name: string;
  symbol: string;
}

export type Clock = number;

export interface Shape {
  orig: string;
  dest?: string;
  brush?: string;
}
