import { importXiangqiNotation } from 'lib/game/xiangqiNotation';
import { importedTree } from 'lib/tree/native';

import { type Player, type AnalyseData, type Game } from './interfaces';

/** Parse through the native rules and canonical tree boundary. */
export default async function (pgn: string): Promise<Partial<AnalyseData>> {
  const imported = await importXiangqiNotation(pgn);
  const root = importedTree(imported);
  return {
    game: {
      fen: root.fen,
      initialFen: root.fen,
      id: 'synthetic',
      player: imported.state.turn === 'red' ? 'red' : 'black',
      status: { id: 20, name: 'started' },
      turns: root.ply,
      variant: { key: 'xiangqi', name: 'Xiangqi', short: 'Xiangqi' },
    } as Game,
    player: { color: 'red' } as Player,
    opponent: { color: 'black' } as Player,
    tree: root,
    userAnalysis: true,
  };
}

export const renderNotationError = (error = '') => error;
