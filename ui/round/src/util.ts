import type { Dests } from 'chessgroundx/types';

import { selectXiangqiNotation, xiangqiLegalMoveDests } from 'lib/game';

import type { EncodedDests, RoundData, Step } from './interfaces';

export function parsePossibleMoves(dests?: EncodedDests): Dests {
  if (!dests) return new Map();
  return xiangqiLegalMoveDests(
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
