import type { BookData } from '@lixiangqi/explorer';

import { requestXiangqi } from 'lib/game/xiangqiApi';
import { rulesPositionKey, type RulesPosition } from 'lib/game/xiangqiNotation';

import type { ExplorerResult } from './analysisSuggestions';

/** Session cache includes history: the book API filters moves using native rules. */
export class AnalysisCloud {
  private readonly cache = new Map<string, ExplorerResult>();

  async get(position: RulesPosition, signal: AbortSignal): Promise<ExplorerResult | undefined> {
    const key = rulesPositionKey(position);
    const cached = this.cache.get(key);
    if (cached) return cached;
    try {
      const book = await requestXiangqi<BookData>(
        '/api/analysis/book',
        { ...position, metric: 'dtm', endgame: false },
        signal,
      );
      if (signal.aborted) return undefined;
      const result: ExplorerResult = {
        available: book.moves.length > 0,
        source: book.sourceUrl,
        moves: book.moves.map(move => ({ ...move, pvMoves: [move.move], wxfMoves: [move.notation] })),
      };
      this.cache.set(key, result);
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
      return result;
    } catch {
      // A provider outage must still allow local analysis, and is not a cached miss.
      return undefined;
    }
  }
}
