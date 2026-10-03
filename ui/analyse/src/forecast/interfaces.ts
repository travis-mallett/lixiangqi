import type { RulesState } from 'lib/game/xiangqiNotation';
export interface ForecastData {
  onMyTurn?: boolean;
  steps?: ForecastStep[][];
}

export interface ForecastStep {
  ply: Ply;
  uci: Uci;
  notation: San;
  fen: FEN;
  state: RulesState;
}

export type ForecastList = ForecastStep[][];
