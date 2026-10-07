import { storage } from '../storage';
import { aiLevels } from './aiLevel';
import type { GameData } from './interfaces';
import { finished } from './status';
import { XIANGQI_START_FEN } from './xiangqi';

const guestKey = 'ai.progress.anon';
const maxLevel = aiLevels[aiLevels.length - 1];

export const highestBeatenAiLevel = (levels: readonly { level: number; mine?: { wins: number } }[]): number =>
  levels.reduce((highest, item) => (item.mine?.wins ? Math.max(highest, item.level) : highest), 0);

export const nextAiLevel = (completed: number): number => Math.min(completed + 1, maxLevel);

export function guestAiProgress(): number {
  try {
    const level = Number(storage.get(guestKey));
    return Number.isInteger(level) && level >= 0 && level <= maxLevel ? level : 0;
  } catch {
    return 0;
  }
}

/** Only the player's server-reported, normal-start AI wins advance guest progress. */
export function recordGuestAiWin(data: GameData): void {
  const level = data.opponent.ai;
  if (
    data.player.user ||
    data.player.spectator ||
    !level ||
    !aiLevels.includes(level) ||
    data.game.source !== 'ai' ||
    data.game.variant.key !== 'standard' ||
    (data.game.initialFen && data.game.initialFen !== XIANGQI_START_FEN) ||
    !finished(data) ||
    data.game.winner !== data.player.color
  )
    return;
  try {
    if (level > guestAiProgress()) storage.set(guestKey, level.toString());
  } catch {
    // Unavailable browser storage must not interrupt the game result.
  }
}
