import type { Player } from 'lib/game';
import {
  importXiangqiNotation,
  notationAnnotations,
  type ImportedTreeNode,
  type RulesState,
} from 'lib/game/xiangqiNotation';
import { completeNode } from 'lib/tree/node';
import type { TreeNode } from 'lib/tree/types';

import type { AnalyseData, Game } from './interfaces';
import { storedStudyMarks } from './study/boardMarks';

/** Use the same native rules boundary as analysis and embeds. These IDs are local to this imported tree. */
export default async function (pgn: string): Promise<Partial<AnalyseData>> {
  const imported = await importXiangqiNotation(pgn);
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let sequence = 0;
  const build = (
    state: RulesState,
    children: ImportedTreeNode[],
    comments: string[] = [],
    move?: ImportedTreeNode,
  ): TreeNode => {
    const index = sequence++;
    const annotations = notationAnnotations(comments);
    return completeNode('xiangqi')({
      id: move ? alphabet[Math.floor(index / alphabet.length)] + alphabet[index % alphabet.length] : '',
      ply: state.ply,
      fen: state.fen,
      uci: move?.move,
      san: move?.notation,
      sanZh: move?.chineseNotation,
      xiangqiLegalMoves: state.legalMoves,
      xiangqiCheck: state.check,
      comments: annotations.comments.map((text, i) => ({ id: `${index}-${i}`, by: '', text })),
      shapes: storedStudyMarks(annotations.marks),
      glyphs: move?.glyphs?.map(id => ({
        id,
        name: `$${id}`,
        symbol:
          ({ 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' } as Record<number, string>)[id] ?? `$${id}`,
      })),
      children: children.map(child => build(child.state, child.children, child.comments, child)),
    });
  };
  const root = build(imported.state, imported.children, imported.comments);
  return {
    game: {
      fen: root.fen,
      initialFen: root.fen,
      id: 'synthetic',
      player: imported.state.turn === 'red' ? 'white' : 'black',
      status: { id: 20, name: 'started' },
      turns: root.ply,
      variant: { key: 'xiangqi', name: 'Xiangqi', short: 'Xiangqi' },
    } as Game,
    player: { color: 'white' } as Player,
    opponent: { color: 'black' } as Player,
    treeParts: [root],
    userAnalysis: true,
  };
}

export const renderPgnError = (error = '') => (error ? `PGN: ${error}` : '');
