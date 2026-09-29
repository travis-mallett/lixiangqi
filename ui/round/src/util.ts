import { moveDestinations } from '@lixiangqi/board';

import { selectXiangqiNotation } from 'lib/game';
import type { RecordedClockPlayback } from 'lib/game/replay/recordedClockPlayback';
import { game as gameRoute } from 'lib/game/router';

import type { EncodedDests, RoundData, Step } from './interfaces';

export const analysisUrl = (d: RoundData, ply: number): string =>
  gameRoute(d, d.game.variant.key === 'racingKings' ? 'white' : d.player.color) + '/analysis#' + ply;

export const canToggleRecordedClockPlayback = (d: RoundData, playback?: RecordedClockPlayback): boolean =>
  !!playback && playback.timeline.delays.length > 0 && !!d.tv && d.player.spectator === true;

export function parsePossibleMoves(dests?: EncodedDests): ReadonlyMap<string, readonly string[]> {
  if (!dests) return new Map();
  return moveDestinations(
    Object.entries(dests).flatMap(([orig, destinations]) => destinations.map(dest => orig + dest)),
  );
}

export const firstPly = (d: RoundData): number => d.steps[0].ply;

export const lastPly = (d: RoundData): number => lastStep(d).ply;

export const lastStep = (d: RoundData): Step => d.steps[d.steps.length - 1];

export const plyStep = (d: RoundData, ply: number): Step => d.steps[ply - firstPly(d)];

export const upgradeServerData = (d: RoundData): void => {
  if (d.correspondence) d.correspondence.showBar = d.pref.clockBar;

  d.pref.showCaptured = false;
  d.steps.forEach(step => {
    step.san = selectXiangqiNotation(step.san, step.sanZh, d.pref.notationStyle);
  });

  if (d.expiration) d.expiration.movedAt = Date.now() - d.expiration.idleMillis;
};
