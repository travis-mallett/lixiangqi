import type { GameData } from '@/game';

import { defined } from './index';
import { poolId } from './setup/timeControl';
import { storage } from './storage';

const makeKey = (username: string | undefined, poolId: string) =>
  `lobby-pool-range.${username || 'anon'}.${poolId}`;

export const set = (username: string | undefined, poolId: string, range: string | undefined): void => {
  const key = makeKey(username, poolId);
  if (range) storage.set(key, range);
  else storage.remove(key);
};

export const get = (username: string | undefined, poolId: string): string | null =>
  storage.get(makeKey(username, poolId));

export const shiftRangeAfter = (game: GameData): void => {
  const username = game.player.user?.username,
    delta = game.player.ratingDiff;
  if (
    game.game.variant.key === 'standard' &&
    username &&
    delta &&
    defined(game.clock?.initial) &&
    defined(game.clock?.increment)
  ) {
    const id = poolId(`${game.clock.initial / 60}+${game.clock.increment}`, game.game.moveTime);
    const currRange = get(username, id);
    if (!currRange) return;
    const [min, max] = currRange.split('-').map(Number);
    set(username, id, `${min + delta}-${max + delta}`);
  }
};
