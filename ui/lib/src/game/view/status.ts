import type { GameData, StatusName } from '@/game';

import { adjudicationText } from '../adjudication';

export interface StatusData {
  winner?: Color;
  status: StatusName;
  abortedBy?: Color;
  ply: Ply;
  termination?: string | null;
  drawOffers?: number[];
}

export default function status(d: GameData): string {
  return statusOf({
    winner: d.game.winner,
    status: d.game.status.name,
    abortedBy: d.game.abortedBy,
    ply: d.game.turns,
    termination: d.game.termination,
    drawOffers: d.game.drawOffers,
  });
}
export function statusOf(d: StatusData): string {
  const winnerSuffix = d.winner
    ? ' • ' + i18n.site[d.winner === 'white' ? 'whiteIsVictorious' : 'blackIsVictorious']
    : '';
  const adjudication = adjudicationText(d.termination);
  if (adjudication) return adjudication + winnerSuffix;
  switch (d.status) {
    case 'started':
      return i18n.site.playingRightNow;
    case 'aborted':
      const abortReasonText = d.abortedBy
        ? i18n.site[d.abortedBy === 'white' ? 'whiteAborted' : 'blackAborted']
        : d.ply === 0
          ? i18n.site.whiteDidntMove
          : i18n.site.blackDidntMove;
      return `${abortReasonText}${winnerSuffix}`;
    case 'mate':
      return i18n.site.checkmate + winnerSuffix;
    case 'resign':
      return i18n.site[d.winner === 'white' ? 'blackResigned' : 'whiteResigned'] + winnerSuffix;
    case 'stalemate':
      return i18n.site.stalemate + winnerSuffix;
    case 'timeout':
      switch (d.winner) {
        case 'white':
          return i18n.site.blackLeftTheGame + winnerSuffix;
        case 'black':
          return i18n.site.whiteLeftTheGame + winnerSuffix;
        default:
          return `${d.ply % 2 === 0 ? i18n.site.whiteLeftTheGame : i18n.site.blackLeftTheGame} • ${i18n.site.draw}`;
      }
    case 'draw': {
      if (d.drawOffers?.some(turn => turn >= d.ply)) return i18n.site.drawByMutualAgreement;
      return i18n.site.draw;
    }
    case 'insufficientMaterialClaim':
      return `${i18n.site.drawClaimed} • ${i18n.site.insufficientMaterial}`;
    case 'outoftime':
      return `${d.ply % 2 === 0 ? i18n.site.whiteTimeOut : i18n.site.blackTimeOut}${
        winnerSuffix || ` • ${i18n.site.draw}`
      }`;
    case 'noStart':
      return (d.winner === 'white' ? i18n.site.blackDidntMove : i18n.site.whiteDidntMove) + winnerSuffix;
    case 'cheat':
      return i18n.site.cheatDetected + winnerSuffix;
    case 'variantEnd':
      return i18n.site.variantEnding + winnerSuffix;
    case 'unknownFinish':
      return d.winner
        ? i18n.site[d.winner === 'white' ? 'whiteIsVictorious' : 'blackIsVictorious']
        : i18n.site.finished;
    default:
      return d.status + winnerSuffix;
  }
}
