import type { BoardMark } from '@lixiangqi/board';

import { requestXiangqi } from './xiangqiApi';

export interface RulesState {
  variant?: string;
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
  needsHydration?: boolean;
}

export interface ImportedTreeNode {
  move: string;
  notation: string;
  chineseNotation?: string;
  state: RulesState;
  children: ImportedTreeNode[];
  comments?: string[];
  glyphs?: number[];
}

export interface ImportedMoveTree {
  headers?: Record<string, string>;
  comments?: string[];
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
            const match = /^([GRBY])([a-i](?:10|[1-9]|:))([a-i](?:10|[1-9]|:))?$/.exec(value.trim());
            if (!match || (kind === 'a') !== !!match[3]) continue;
            marks.push({
              from: match[2].replace(':', '10'),
              to: match[3]?.replace(':', '10'),
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
    const color = Object.keys(markBrushes).find(key => markBrushes[key] === mark.brush) ?? 'G';
    (mark.to ? arrows : circles).push(`${color}${mark.from}${mark.to ?? ''}`);
  }
  return [
    circles.length ? `[%csl ${circles.join(',')}]` : '',
    arrows.length ? `[%cal ${arrows.join(',')}]` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
