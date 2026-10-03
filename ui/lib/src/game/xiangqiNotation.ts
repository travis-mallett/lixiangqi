import type { BoardMark } from '@lixiangqi/board';

import { requestXiangqi } from './xiangqiApi';

export interface RulesState {
  variant?: string;
  ruleset?: string;
  adjudication?: Record<string, unknown>;
  fen: string;
  ply: number;
  turn: 'red' | 'black';
  legalMoves: string[];
  check: boolean;
  capture?: boolean;
  checkmate?: boolean;
  termination?: string | null;
  insufficientMaterial?: boolean;
  gameResult: string;
  immediateEnd?: { ended: boolean; result: number };
  optionalEnd?: { ended: boolean; result: number };
}

export type CommentAuthor =
  | { kind: 'user'; id: string; name: string }
  | { kind: 'external'; name: string }
  | { kind: 'site' }
  | { kind: 'unknown' };

export interface NotationComment {
  text: string;
  id?: string;
  by?: CommentAuthor;
}

export interface NotationAnnotations {
  comments: NotationComment[];
  shapes: { orig: string; dest?: string; brush: string }[];
  clock?: number;
  elapsed?: number;
  evaluation?: { cp?: number; mate?: number; depth?: number };
  study?: {
    forceVariation: boolean;
    gamebook?: { deviation?: string; hint?: string };
    computer: boolean;
    clockTrust?: boolean;
  };
}

export interface ImportedTreeNode {
  move: string;
  result?: string;
  notation: string;
  chineseNotation?: string;
  state: RulesState;
  children: ImportedTreeNode[];
  annotations: NotationAnnotations;
  glyphs?: number[];
}

export interface ImportedMoveTree {
  headers?: Record<string, string>;
  ruleset: string;
  glyphs?: number[];
  annotations: NotationAnnotations;
  initialFen: string;
  state: RulesState;
  children: ImportedTreeNode[];
}

/** Native notation accepts WXF, Chinese notation, or coordinate moves, with recursive variations. */
export async function importXiangqiNotation(
  notation: string,
  initialFen?: string,
  signal?: AbortSignal,
): Promise<ImportedMoveTree> {
  return requestXiangqi('/api/analysis/import', { notation, ...(initialFen ? { initialFen } : {}) }, signal);
}

/** Semicolon comments preserve arbitrary braces and backslashes without injecting notation. */
export function notationComments(comments: readonly string[] = []): string {
  return comments
    .map(
      comment =>
        '\n' +
        comment
          .split(/\r?\n/)
          .map(line => `;${line}`)
          .join('\n') +
        '\n',
    )
    .join('');
}

const markBrushes: Record<string, string> = { G: 'green', R: 'red', B: 'blue', Y: 'yellow' };

/** Annotation tags are data. Never interpret comment text as SVG or HTML. */
export function notationAnnotations(input: readonly string[] = []): {
  comments: string[];
  marks: BoardMark[];
} {
  const marks: BoardMark[] = [];
  const comments = input
    .map(comment =>
      comment
        .replace(/\[%c([sa])l\s+([^\]]+)\]/g, (_, kind: string, content: string) => {
          for (const value of content.split(',')) {
            const match = /^([GRBY])([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))?$/.exec(value.trim());
            if (!match || (kind === 'a') !== !!match[3])
              throw new Error(`Invalid Xiangqi annotation: ${value}`);
            marks.push({
              from: match[2],
              to: match[3],
              brush: markBrushes[match[1]],
            });
          }
          return '';
        })
        .trim(),
    )
    .filter(Boolean);
  return { comments, marks };
}

export function notationMarks(marks: readonly BoardMark[] = []): string {
  const circles: string[] = [],
    arrows: string[] = [];
  for (const mark of marks) {
    const color = Object.keys(markBrushes).find(key => markBrushes[key] === (mark.brush ?? 'green'));
    if (!color) throw new Error(`Unsupported notation brush: ${mark.brush}`);
    if (!/^[a-i](?:10|[1-9])$/.test(mark.from) || (mark.to && !/^[a-i](?:10|[1-9])$/.test(mark.to)))
      throw new Error('Invalid Xiangqi annotation location');
    (mark.to ? arrows : circles).push(`${color}${mark.from}${mark.to ?? ''}`);
  }
  return [
    circles.length ? `[%csl ${circles.join(',')}]` : '',
    arrows.length ? `[%cal ${arrows.join(',')}]` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface VariationMove {
  move: string;
  notation: string;
  chineseNotation: string;
  state: RulesState;
}

const variationCache = new Map<string, { moves: VariationMove[] }>();

export async function replayXiangqiVariation(
  initialFen: string,
  moves: readonly string[],
  ruleset: string,
  variation: readonly string[],
  signal?: AbortSignal,
): Promise<{ moves: VariationMove[] }> {
  const key = JSON.stringify([ruleset, initialFen, moves, variation]);
  const cached = variationCache.get(key);
  if (cached) return cached;
  const result = await requestXiangqi<{ moves: VariationMove[] }>(
    '/api/analysis/variation',
    { initialFen, moves, ruleset, variation },
    signal,
  );
  if (
    result.moves.length !== variation.length ||
    result.moves.some((node, index) => node.move !== variation[index])
  )
    throw new Error('Native variation service returned an incomplete move line');
  variationCache.set(key, result);
  while (variationCache.size > 128) variationCache.delete(variationCache.keys().next().value!);
  return result;
}

export interface RulesPosition {
  initialFen: string;
  moves: string[];
  ruleset: string;
}

export const rulesPositionKey = (position: RulesPosition): string =>
  JSON.stringify([position.ruleset, position.initialFen, position.moves]);
