import type { ImportedMoveTree, ImportedTreeNode, NotationAnnotations } from 'lib/game/xiangqiNotation';

import { messageLinks } from './links';

export type BoardSource = { kind: 'fen' | 'pgn' | 'link'; value: string; inline: boolean };
export type BoardShape = NotationAnnotations['shapes'][number];
export interface BoardFrame {
  fen: string;
  ply: number;
  turn: 'red' | 'black';
  move?: string;
  check: boolean;
  capture: boolean;
  checkmate: boolean;
  shapes: BoardShape[];
}
export interface MessageBoard {
  frames: BoardFrame[];
  orientation: 'red' | 'black';
  start: number;
  path?: string;
  inline?: string;
}
export interface BoardSubmission {
  source: BoardSource;
  start: number;
  end: number;
  marks: { ply: number; fen: string; shapes: BoardShape[] }[];
}

const fen =
  /(?:^|[\s(`])((?:[rnbakcpheRNBAKCPHE1-9]+\/){9}[rnbakcpheRNBAKCPHE1-9]+(?:[ \t]+[wbr](?:[ \t]+-[ \t]+-[ \t]+\d+[ \t]+\d+)?)?)(?=$|[\s)`.!,])/g;
const pgnStart =
  /^(?:[ \t]*\[(?:Event|Site|Date|Round|Red|White|Black|Result|FEN|SetUp|Variant|Ruleset)\s+"|[ \t]*\d+\.(?:\.\.)?\s*\S)/im;
const pgnEnd = /(?:^|[ \t])(?:1-0|0-1|1\/2-1\/2|\*)(?=[ \t]*$)/m;
const boardPath =
  /^\/(?:[a-z]{2,3}\/)?training\/(?:[\w-]+\/)?(?:[a-z\d]{5}|\d{6,})$|^\/(?:embed\/(?:game\/)?)?[a-z\d]{8}(?:\/(?:white|black)(?:\/analysis)?)?$/i;

export function boardSources(text: string): BoardSource[] {
  const result: BoardSource[] = [];
  const start = pgnStart.exec(text);
  if (start) {
    const block = text.slice(start.index);
    const end = pgnEnd.exec(block);
    const length = end ? end.index + end[0].length : block.length;
    result.push({ kind: 'pgn', value: block.slice(0, length).trim(), inline: true });
    text = text.replace(result[0].value, '');
  }
  for (const match of text.matchAll(fen)) result.push({ kind: 'fen', value: match[1], inline: true });
  for (const match of messageLinks(text)) {
    const url = new URL(match.url);
    if (['lixiangqi.com', 'www.lixiangqi.com'].includes(url.hostname) && boardPath.test(url.pathname))
      result.push({ kind: 'link', value: match.raw, inline: true });
  }
  return result;
}

export function boardFileKind(name: string): 'fen' | 'pgn' | undefined {
  if (/\.fen$/i.test(name)) return 'fen';
  if (/\.pgn$/i.test(name)) return 'pgn';
  return undefined;
}

export function boardMessageText(text: string, boards?: MessageBoard[]): string {
  if (!boards?.length) return text;
  for (const board of boards) if (board.inline) text = text.replace(board.inline, '');
  return text.trim();
}

export function replayTree(board: MessageBoard): ImportedMoveTree {
  const annotations = (frame: BoardFrame) => ({ comments: [], shapes: frame.shapes });
  const state = (frame: BoardFrame) => ({ ...frame, legalMoves: [], gameResult: '*' });
  let children: ImportedTreeNode[] = [];
  for (const frame of board.frames.slice(1).reverse())
    children = [
      {
        move: frame.move!,
        notation: frame.move!,
        state: state(frame),
        annotations: annotations(frame),
        children,
      },
    ];
  const root = board.frames[0];
  return {
    initialFen: root.fen,
    ruleset: 'unrestricted-v1',
    annotations: annotations(root),
    state: state(root),
    children,
  };
}
